// Hot-lead alerts. Every hot lead is recorded in the audit trail; when a
// Knock API key is configured the `hot-lead-alert` workflow is triggered too
// (email/in-app delivery through whatever provider is connected in the Knock
// dashboard — see README → Hot-lead alerts).
//
//   KNOCK_API_KEY          server-side secret (Sites → Secrets)
//   KNOCK_WORKFLOW_KEY     workflow key, default "hot-lead-alert"
//   ALERT_RECIPIENT_IDS    comma-separated Knock recipient ids; defaults to
//                          the tenant id so a single-tenant setup works with
//                          one user whose id equals the institution id.
import { getRepo } from "@/lib/repo";
import type { Lead } from "@/lib/types";

const KNOCK_BASE = "https://api.knock.app/v1";

export function notifyConfigured(): boolean {
  return Boolean(process.env.KNOCK_API_KEY);
}

/** Never throws: alerting must not break the conversation flow. */
export async function notifyHotLead(
  tenantId: string,
  lead: Lead,
  conversationId?: string,
): Promise<void> {
  const repo = await getRepo();
  const label = lead.name || lead.phone;

  let failure: string | null = null;
  if (notifyConfigured()) {
    try {
      const workflow = process.env.KNOCK_WORKFLOW_KEY || "hot-lead-alert";
      const recipients = (process.env.ALERT_RECIPIENT_IDS || tenantId)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`${KNOCK_BASE}/workflows/${workflow}/trigger`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KNOCK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "hot-lead",
          recipients,
          data: {
            tenantId,
            leadId: lead.id,
            leadName: label,
            phone: lead.phone,
            score: lead.score,
            course: lead.courseInterest ?? "",
            city: lead.city ?? "",
            language: lead.language,
            conversationId: conversationId ?? "",
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        failure = `Knock ${res.status}: ${body.slice(0, 200)}`;
      }
    } catch (err) {
      failure = String(err).slice(0, 300);
    }
  }

  await repo.addAudit({
    id: crypto.randomUUID(),
    tenantId,
    actor: "system",
    action: failure ? "notify.failed" : "lead.hot_alert",
    detail: failure
      ? `Hot lead ${label} — alert failed: ${failure}`
      : notifyConfigured()
        ? `Hot lead ${label} (score ${lead.score}) — counselor alert sent`
        : `Hot lead ${label} (score ${lead.score}) — recorded; set KNOCK_API_KEY to email counselors`,
    sources: [],
    conversationId,
    createdAt: new Date().toISOString(),
  });
}
