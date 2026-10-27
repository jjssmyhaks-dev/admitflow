// Inbound WhatsApp Cloud API webhook.
//
//   GET  /api/webhooks/whatsapp?tenant=<orgId>
//        Meta's verification challenge — echoes hub.challenge when
//        hub.verify_token matches WHATSAPP_VERIFY_TOKEN.
//   POST /api/webhooks/whatsapp?tenant=<orgId>
//        Signed (X-Hub-Signature-256 over the raw body with
//        WHATSAPP_APP_SECRET). Handles:
//          · inbound text/button/interactive replies → the agent, whose reply
//            is sent back on the open 24-hour service window
//          · STOP / START → lead opt-out / opt-in (mirrors the chat guardrail)
//          · status callbacks (sent/delivered/read/failed) → audit trail
//        The tenant is part of the callback URL Meta has configured — there
//        is no tenant input in the signed payload itself.
//
// Register in Meta App Dashboard → WhatsApp → Configuration → Webhook:
//   Callback URL: https://<host>/api/webhooks/whatsapp?tenant=<orgId>
//   Verify token: the value of WHATSAPP_VERIFY_TOKEN
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRepo, uid } from "@/lib/repo";
import { handleInquiry } from "@/lib/agent";
import { normalizeRecipient, sendSessionMessage, whatsappConfigured } from "@/lib/whatsapp";
import { limitOr429 } from "@/lib/ratelimit";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    expected &&
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === expected &&
    p.get("hub.challenge") !== null
  ) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("verification failed", { status: 403 });
}

function signatureOk(raw: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(raw).digest();
  const provided = Buffer.from(header.slice("sha256=".length), "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

const STOP_RE = /^(stop|unsubscribe|opt[\s_-]?out|cancel)\b/i;
const START_RE = /^(start|subscribe|opt[\s_-]?in|unstop|resume)\b/i;

interface InboundText {
  from: string;
  text: string;
  wamid: string;
}

/** Text extraction across the shapes Meta sends: plain text, quick replies,
 *  and interactive button/list responses. Everything else returns null. */
function inboundText(m: Record<string, any>): InboundText | null {
  const from = typeof m.from === "string" ? m.from : null;
  if (!from) return null;
  const wamid = typeof m.id === "string" ? m.id : "";
  if (m.type === "text" && typeof m.text?.body === "string") {
    return { from, text: m.text.body, wamid };
  }
  if (m.type === "button" && typeof m.button?.text === "string") {
    return { from, text: m.button.text, wamid };
  }
  if (m.type === "interactive") {
    const title =
      m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    if (typeof title === "string") return { from, text: title, wamid };
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Meta retries in bursts; cap the volume before any parsing.
  const limited = limitOr429("wa-webhook", req, 120, 60_000);
  if (limited) return limited;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "WhatsApp app secret not configured" }, { status: 503 });
  }
  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  const tenantId = req.nextUrl.searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });
  const repo = await getRepo();
  if (!(await repo.getTenant(tenantId))) {
    return NextResponse.json({ error: "unknown tenant" }, { status: 404 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const now = new Date().toISOString();
  try {
    const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value ?? {};
        // Only accept traffic for our own business number when it is known.
        const configuredId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const fromId = value?.metadata?.phone_number_id;
        if (configuredId && fromId && fromId !== configuredId) continue;

        for (const m of Array.isArray(value.messages) ? value.messages : []) {
          await handleInbound(repo, tenantId, m, now);
        }
        for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
          await handleStatus(repo, tenantId, s, now);
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Meta retries non-2xx: acknowledge anyway, but leave a trace.
    console.error("whatsapp webhook error", err);
    try {
      await repo.addAudit({
        id: uid(),
        tenantId,
        actor: "system",
        action: "whatsapp.webhook_error",
        detail: String(err).slice(0, 300),
        sources: [],
        createdAt: new Date().toISOString(),
      });
    } catch {
      /* audit store unavailable — console.error already logged */
    }
    return NextResponse.json({ ok: true });
  }
}

async function handleInbound(
  repo: Awaited<ReturnType<typeof getRepo>>,
  tenantId: string,
  m: Record<string, any>,
  now: string,
) {
  const msg = inboundText(m);
  if (!msg) {
    await repo.addAudit({
      id: uid(),
      tenantId,
      actor: "lead",
      action: "whatsapp.unhandled_type",
      detail: `Ignored non-text WhatsApp message of type ${String(m?.type ?? "unknown")}`,
      sources: [],
      createdAt: now,
    });
    return;
  }

  const phone = normalizeRecipient(msg.from);
  const leads = await repo.listLeads(tenantId);
  let lead = leads.find((l) => normalizeRecipient(l.phone) === phone) ?? null;

  // STOP / START mirror the chat opt-out guardrail (TRAI + Meta policy).
  if (STOP_RE.test(msg.text.trim())) {
    if (lead) {
      lead.optedOut = true;
      lead.status = "opted_out";
      lead.updatedAt = now;
    } else {
      lead = {
        id: uid(),
        tenantId,
        name: "",
        phone: `+${phone}`,
        source: "whatsapp",
        score: 0,
        tier: "cold",
        status: "opted_out",
        language: "en",
        optedOut: true,
        createdAt: now,
        updatedAt: now,
      };
    }
    await repo.upsertLead(lead);
    await repo.addAudit({
      id: uid(),
      tenantId,
      actor: "lead",
      action: "whatsapp.optout",
      detail: `STOP from +${phone} — opted out of further messages`,
      sources: [],
      createdAt: now,
    });
    if (whatsappConfigured()) {
      const res = await sendSessionMessage(
        phone,
        "You have been opted out and will not receive further messages. Reply START to opt in again.",
      );
      if (!res.ok) console.error("whatsapp optout reply failed", res.error);
    }
    return;
  }

  if (lead?.optedOut) {
    await repo.addAudit({
      id: uid(),
      tenantId,
      actor: "lead",
      action: "whatsapp.ignored_optout",
      detail: `Message from opted-out +${phone} ignored`,
      sources: [],
      createdAt: now,
    });
    return;
  }

  if (START_RE.test(msg.text.trim()) && lead) {
    lead.optedOut = false;
    if (lead.status === "opted_out") lead.status = "nurturing";
    lead.updatedAt = now;
    await repo.upsertLead(lead);
    await repo.addAudit({
      id: uid(),
      tenantId,
      actor: "lead",
      action: "whatsapp.optin",
      detail: `START from +${phone} — opted back in`,
      sources: [],
      createdAt: now,
    });
    if (whatsappConfigured()) {
      const res = await sendSessionMessage(phone, "You are opted in again. How can we help with your admission?");
      if (!res.ok) console.error("whatsapp optin reply failed", res.error);
    }
    return;
  }

  // Normal message → the agent; its reply goes straight back out on the
  // service window this very message just opened.
  const result = await handleInquiry({
    tenantId,
    channel: "whatsapp",
    text: msg.text,
    leadPhone: `+${phone}`,
  });

  if (whatsappConfigured()) {
    const res = await sendSessionMessage(phone, result.reply);
    if (!res.ok) {
      await repo.addAudit({
        id: uid(),
        tenantId,
        actor: "system",
        action: "whatsapp.send_failed",
        detail: `${res.retryable ? "retryable" : "permanent"}: ${res.error}`,
        sources: [],
        conversationId: result.conversationId,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

async function handleStatus(
  repo: Awaited<ReturnType<typeof getRepo>>,
  tenantId: string,
  s: Record<string, any>,
  now: string,
) {
  const status = typeof s?.status === "string" ? s.status : "";
  if (!["sent", "delivered", "read", "failed"].includes(status)) return;

  const wamid = String(s?.id ?? "unknown");
  const recipient = normalizeRecipient(String(s?.recipient_id ?? ""));
  const leads = await repo.listLeads(tenantId);
  const lead = recipient
    ? leads.find((l) => normalizeRecipient(l.phone) === recipient) ?? null
    : null;
  let conversationId: string | undefined;
  if (lead) {
    const convs = await repo.listConversations(tenantId);
    conversationId = convs.find((c) => c.leadId === lead.id)?.id;
  }

  let detail = `${status} ${wamid}${recipient ? ` → +${recipient}` : ""}`;
  if (status === "failed" && Array.isArray(s?.errors) && s.errors.length > 0) {
    const e = s.errors[0];
    detail += ` — error ${e?.code ?? "?"}: ${String(e?.title ?? e?.message ?? "").slice(0, 160)}`;
  }

  await repo.addAudit({
    id: uid(),
    tenantId,
    actor: "system",
    action: `whatsapp.${status}`,
    detail,
    sources: [],
    conversationId,
    createdAt: now,
  });
}
