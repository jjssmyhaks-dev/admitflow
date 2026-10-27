import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { ocrConfigured, processPending } from "@/lib/ocr";
import { requireCronOrAdmin, type MachineAuthz } from "@/lib/authz";
import { limitOr429 } from "@/lib/ratelimit";

// Async extraction trigger — drains every `processing` document.
// Auth: x-cron-secret: CRON_SECRET (scheduler), x-webhook-secret: OCR_RUN_SECRET
// or LEAD_WEBHOOK_SECRET, or an admin session.
//   POST ?tenant=<id> | { tenantId }  — one tenant
//   POST (secret, no tenant)          — every tenant
// The ingest route also schedules a run right after an upload that needs it.

async function resolveTenantIds(
  auth: Extract<MachineAuthz, { ok: true }>,
  explicit: string | null,
): Promise<string[] | NextResponse> {
  if (auth.via === "session") {
    if (explicit && explicit !== auth.tenantId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return [auth.tenantId];
  }
  const repo = await getRepo();
  if (explicit) {
    if (!(await repo.getTenant(explicit))) {
      return NextResponse.json({ error: "unknown tenant" }, { status: 404 });
    }
    return [explicit];
  }
  return (await repo.listTenants()).map((t) => t.id);
}

async function respond(req: NextRequest, explicit: string | null) {
  const limited = limitOr429("ocr", req, 10, 60_000);
  if (limited) return limited;
  const auth = await requireCronOrAdmin(req, "manage", "OCR_RUN_SECRET", "LEAD_WEBHOOK_SECRET");
  if (!auth.ok) return auth.response;

  const tenantIds = await resolveTenantIds(auth, explicit);
  if (tenantIds instanceof NextResponse) return tenantIds;

  const results: Record<string, unknown> = {};
  for (const tenantId of tenantIds) results[tenantId] = await processPending(tenantId);
  return NextResponse.json({ ok: true, ocr: ocrConfigured(), tenants: tenantIds.length, results });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { tenantId?: string };
  return respond(req, body.tenantId ?? null);
}

export async function GET(req: NextRequest) {
  return respond(req, req.nextUrl.searchParams.get("tenant"));
}
