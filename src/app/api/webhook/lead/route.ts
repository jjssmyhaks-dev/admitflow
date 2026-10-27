import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleInquiry } from "@/lib/agent";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { webhookSecretOk } from "@/lib/authz";
import { limitOr429 } from "@/lib/ratelimit";
import { leadLimit } from "@/lib/limits";

// Lead form webhook: POST { tenantId, name, phone, course?, city?, message?, secret }
const Body = z.object({
  tenantId: z.string().min(1),
  secret: z.string().optional(),
  name: z.string().optional().default(""),
  phone: z.string().min(6),
  course: z.string().optional(),
  city: z.string().optional(),
  message: z.string().optional().default("New lead from website form"),
  source: z.enum(["lead_form", "whatsapp", "web_widget", "manual"]).optional().default("lead_form"),
});

export async function POST(req: NextRequest) {
  const limited = limitOr429("lead-webhook", req, 60, 60_000);
  if (limited) return limited;
  await ensureSeed();
  const headerSecret = req.headers.get("x-webhook-secret") ?? undefined;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { secret, ...payload } = parsed.data;
  const check = webhookSecretOk(secret ?? headerSecret, "LEAD_WEBHOOK_SECRET");
  if (!check.configured) {
    // Never fall back to a default value: an unset secret rejects instead.
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }
  if (!check.ok) {
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  // Unknown tenant → 404 (a guessed tenantId must not create orphan data).
  const repo = await getRepo();
  if (!(await repo.getTenant(payload.tenantId))) {
    return NextResponse.json({ error: "unknown tenant" }, { status: 404 });
  }

  // Plan cap: only refuse when this phone would create a NEW lead.
  const phoneDigits = payload.phone.replace(/\D/g, "");
  const leads = await repo.listLeads(payload.tenantId);
  const isNew = !leads.some((l) => l.phone.replace(/\D/g, "") === phoneDigits);
  if (isNew && leads.length >= leadLimit()) {
    return NextResponse.json(
      { error: "lead limit reached for this institution" },
      { status: 429, headers: { "Retry-After": "86400" } },
    );
  }

  const pieces = [
    payload.message,
    payload.name && `My name is ${payload.name}`,
    payload.course && `I am interested in ${payload.course}`,
    payload.city && `I am from ${payload.city}`,
  ].filter(Boolean);

  const result = await handleInquiry({
    tenantId: payload.tenantId,
    channel: payload.source,
    text: pieces.join(". "),
    leadPhone: payload.phone,
    predefined: { name: payload.name, course: payload.course, city: payload.city },
  });

  return NextResponse.json({
    ok: true,
    leadId: result.lead.id,
    tier: result.lead.tier,
    score: result.lead.score,
    handoff: result.handoff,
    conversationId: result.conversationId,
  });
}
