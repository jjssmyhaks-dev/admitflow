import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { leadsToCsv } from "@/lib/nurture";

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });
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
