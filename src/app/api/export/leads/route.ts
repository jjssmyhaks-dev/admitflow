import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { leadsToCsv } from "@/lib/nurture";
import { requireTenant } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireTenant(req.nextUrl.searchParams.get("tenant"), "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.tenantId;
  const repo = await getRepo();
  const leads = await repo.listLeads(tenantId);
  const csv = leadsToCsv(leads);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${tenantId}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
