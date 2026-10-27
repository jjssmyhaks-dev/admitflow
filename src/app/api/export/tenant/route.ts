// Full tenant backup: every record the platform holds for the institution,
// as one JSON attachment. Admin/owner only — it includes the audit log.
import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { requireTenant } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireTenant(req.nextUrl.searchParams.get("tenant"), "manage");
  if (!auth.ok) return auth.response;
  const tenantId = auth.tenantId;
  const repo = await getRepo();

  const [tenant, settings, docs, leads, conversations, audit] = await Promise.all([
    repo.getTenant(tenantId),
    repo.getSettings(tenantId),
    repo.listKnowledge(tenantId),
    repo.listLeads(tenantId),
    repo.listConversations(tenantId),
    repo.listAudit(tenantId, 10_000),
  ]);

  const messages = [];
  for (const c of conversations) {
    messages.push(...(await repo.listMessages(tenantId, c.id)));
  }
  const chunks = [];
  for (const d of docs) {
    chunks.push(...(await repo.listChunks(tenantId, d.id, 10_000)));
  }

  const backup = {
    exportedAt: new Date().toISOString(),
    schema: "admitflow.backup.v1",
    tenant,
    settings,
    knowledge: { docs, chunks },
    leads,
    conversations,
    messages,
    audit,
  };

  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="admitflow-${tenantId}-${backup.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
