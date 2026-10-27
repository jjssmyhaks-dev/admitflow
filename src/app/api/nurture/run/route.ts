import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { dueFollowups, recordFollowup } from "@/lib/nurture";
import { requireCronOrAdmin, type MachineAuthz } from "@/lib/authz";

// Cron-able endpoint. The scheduler (GitHub Actions / any external cron)
// authenticates with x-cron-secret: CRON_SECRET; an admin session works too.
//   POST ?tenant=<id> | { tenantId }  — one tenant
//   POST (secret, no tenant)          — every tenant
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

export async function POST(req: NextRequest) {
  const auth = await requireCronOrAdmin(req, "write", "NURTURE_SECRET", "LEAD_WEBHOOK_SECRET");
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { tenantId?: string };
  const explicit = body.tenantId ?? req.nextUrl.searchParams.get("tenant");
  const tenantIds = await resolveTenantIds(auth, explicit);
  if (tenantIds instanceof NextResponse) return tenantIds;

  const out: Record<string, { due: number; sent: unknown[] }> = {};
  for (const tenantId of tenantIds) {
    const due = await dueFollowups(tenantId);
    const sent = [];
    for (const f of due) sent.push(await recordFollowup(tenantId, f));
    out[tenantId] = { due: due.length, sent };
  }
  return NextResponse.json({ tenants: tenantIds.length, results: out });
}

export async function GET(req: NextRequest) {
  const auth = await requireCronOrAdmin(req, "read", "NURTURE_SECRET", "LEAD_WEBHOOK_SECRET");
  if (!auth.ok) return auth.response;

  const explicit = req.nextUrl.searchParams.get("tenant");
  const tenantIds = await resolveTenantIds(auth, explicit);
  if (tenantIds instanceof NextResponse) return tenantIds;

  const out: Record<string, unknown> = {};
  for (const tenantId of tenantIds) out[tenantId] = await dueFollowups(tenantId);
  return NextResponse.json({ tenants: tenantIds.length, due: out });
}
