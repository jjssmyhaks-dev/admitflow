import { NextRequest, NextResponse } from "next/server";
import { getRepo, uid } from "@/lib/repo";
import { requireTenant } from "@/lib/authz";

export async function POST(req: NextRequest) {
  const { tenantId: requested, leadId, conversationId, status } = await req.json();
  const auth = await requireTenant(requested, "write");
  if (!auth.ok) return auth.response;
  const tenantId = auth.tenantId;
  const repo = await getRepo();
  const lead = await repo.getLead(tenantId, leadId);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date().toISOString();
  lead.status = status;
  lead.updatedAt = now;
  // Outcomes feed lead scoring (PRD 5.3)
  if (status === "applied") lead.score = Math.max(lead.score, 95);
  if (status === "visit_booked") lead.score = Math.max(lead.score, 85);
  if (status === "not_interested" || status === "wrong_fit") {
    lead.score = Math.min(lead.score, 15);
    lead.tier = "cold";
  }
  await repo.upsertLead(lead);

  if (conversationId) {
    const conv = await repo.getConversation(tenantId, conversationId);
    if (conv) {
      conv.lastActivityAt = now;
      await repo.upsertConversation(conv);
    }
    await repo.addMessage({
      id: uid(),
      conversationId,
      tenantId,
      role: "system",
      content: `Outcome marked: ${status.replace("_", " ")}`,
      sources: [],
      createdAt: now,
    });
  }

  await repo.addAudit({
    id: uid(),
    tenantId,
    actor: "counselor",
    action: "lead.outcome",
    detail: `${lead.name || lead.phone} marked ${status}`,
    sources: [],
    conversationId,
    createdAt: now,
  });

  const leads = await repo.listLeads(tenantId);
  const conversations = await repo.listConversations(tenantId);
  const items = conversations.map((c) => {
    const l = leads.find((x) => x.id === c.leadId);
    return {
      conversation: c,
      leadName: l?.name || l?.phone || "Unknown",
      leadPhone: l?.phone ?? "",
      tier: l?.tier ?? "cold",
      score: l?.score ?? 0,
      courseInterest: l?.courseInterest ?? "",
      status: l?.status ?? "new",
    };
  });
  return NextResponse.json({ items });
}
