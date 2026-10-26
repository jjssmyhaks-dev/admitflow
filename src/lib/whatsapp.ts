// Meta WhatsApp Business Cloud API — outbound messages only, plain fetch.
//
//   WHATSAPP_ACCESS_TOKEN     permanent system-user token (server-side secret)
//   WHATSAPP_PHONE_NUMBER_ID  id of the sending business number
//   WHATSAPP_TEMPLATE_NAME    approved template used outside the 24h window
//   WHATSAPP_TEMPLATE_LANG    template language code (default "en")
//
// Session (free-form) messages are allowed only inside the 24-hour customer
// service window that opens when the lead messages the business; outside it
// Meta only accepts pre-approved templates. The nurture engine picks the mode
// for us — see sendNurtureMessage.
//
// References:
//   https://developers.facebook.com/docs/whatsapp/cloud-api/send-messages
//   https://developers.facebook.com/docs/whatsapp/customer-service-windows

const GRAPH_VERSION = "v26.0";
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function whatsappTemplateConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TEMPLATE_NAME);
}

export type SendResult =
  | { ok: true; messageId: string; mode: "session" | "template" }
  | { ok: false; error: string; retryable: boolean };

/** Meta wants E.164 without the leading "+". */
export function normalizeRecipient(phone: string): string {
  return phone.replace(/^\+/, "").replace(/\D/g, "");
}

async function callMessagesApi(body: unknown): Promise<SendResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    return { ok: false, retryable: false, error: "WhatsApp is not configured" };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const err = json?.error ?? {};
      return {
        ok: false,
        // 5xx / 429 → worth retrying on the next run; a 4xx from Meta is a
        // configuration problem (bad template, bad number, expired token).
        retryable: res.status >= 500 || res.status === 429,
        error: `WhatsApp ${res.status}${err.code ? `/${err.code}` : ""}: ${err.message ?? "request failed"}`,
      };
    }
    const messageId = json?.messages?.[0]?.id ?? "";
    return { ok: true, messageId, mode: "session" };
  } catch (err) {
    return { ok: false, retryable: true, error: `WhatsApp request failed: ${String(err).slice(0, 200)}` };
  }
}

/** Free-form message — only valid inside the open service window. */
export async function sendSessionMessage(to: string, text: string): Promise<SendResult> {
  const res = await callMessagesApi({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeRecipient(to),
    type: "text",
    text: { preview_url: false, body: text },
  });
  return res.ok ? { ...res, mode: "session" } : res;
}

/** Pre-approved template — required outside the service window. */
export async function sendTemplateMessage(to: string, text: string): Promise<SendResult> {
  const name = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!name) {
    return {
      ok: false,
      retryable: false,
      error: "outside the 24-hour service window and WHATSAPP_TEMPLATE_NAME is not set",
    };
  }
  const language = process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const payload = (withParams: boolean) => ({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeRecipient(to),
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(withParams
        ? { components: [{ type: "body", parameters: [{ type: "text", text }] }] }
        : {}),
    },
  });

  let res = await callMessagesApi(payload(true));
  // A variable-less template rejects parameters — retry once without them.
  if (!res.ok && res.retryable === false && /param/i.test(res.error)) {
    res = await callMessagesApi(payload(false));
  }
  return res.ok ? { ...res, mode: "template" } : res;
}

/** True when the lead messaged us within the last 24 hours. */
export function isOpenServiceWindow(lastInboundAt: string | undefined): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < SESSION_WINDOW_MS;
}

/**
 * Sends a nurture follow-up on the correct channel mode:
 * session message while the service window is open, template otherwise.
 * `serviceWindowOpen` is decided by the caller from the lead's last inbound
 * message (see nurture.ts).
 */
export async function sendNurtureMessage(
  to: string,
  text: string,
  serviceWindowOpen: boolean,
): Promise<SendResult> {
  if (serviceWindowOpen) return sendSessionMessage(to, text);
  return sendTemplateMessage(to, text);
}
