// Per-tenant plan caps. No billing system yet — these are guard rails so a
// single tenant cannot grow without bound (and so limits exist to bill
// against later). Every cap is env-overridable per deployment.
//
//   KNOWLEDGE_DOC_LIMIT   max ingested documents per tenant (default 100)
//   LEAD_LIMIT            max leads per tenant          (default 10000)

export function planLimit(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const knowledgeDocLimit = () => planLimit("KNOWLEDGE_DOC_LIMIT", 100);
export const leadLimit = () => planLimit("LEAD_LIMIT", 10_000);
