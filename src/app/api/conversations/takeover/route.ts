import { NextRequest, NextResponse } from "next/server";
import { getRepo, uid } from "@/lib/repo";
import { requireTenant } from "@/lib/authz";

export async function POST(req: NextRequest) {
  const { tenantId: requested, conversationId, leadId } = await req.json();
  const auth = await requireTenant(requested, "write");
  if (!auth.ok) return auth.response;
  const tenantId = auth.tenantId;
  const repo = await getRepo();
  const conv = await repo.getConversation(tenantId, conversationId);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  conv.status = "human";
  conv.handoffReason = "Counselor took over";
  conv.lastActivityAt = new Date().toISOString();
  await repo.upsertConversation(conv);

  await repo.addMessage({
    id: uid(),
    conversationId,
    tenantId,
    role: "system",
    content: "Counselor took over this conversation. AI agent paused.",
    sources: [],
    createdAt: new Date().toISOString(),
  });
  await repo.addAudit({
    id: uid(),
    tenantId,
    actor: "counselor",
    action: "conversation.takeover",
    detail: `Took over conversation ${conversationId} (lead ${leadId})`,
    sources: [],
    conversationId,
    createdAt: new Date().toISOString(),
  });

  const messages = await repo.listMessages(tenantId, conversationId);
  const leads = await repo.listLeads(tenantId);
  return NextResponse.json({ messages, items: await buildItems(repo, tenantId, leads) });
}

async function buildItems(
  repo: Awaited<ReturnType<typeof getRepo>>,
  tenantId: string,
  leads: Awaited<ReturnType<Awaited<ReturnType<typeof getRepo>>["listLeads"]>>,
) {
  const conversations = await repo.listConversations(tenantId);
  return conversations.map((c) => {
    const lead = leads.find((l) => l.id === c.leadId);
    return {
      conversation: c,
      leadName: lead?.name || lead?.phone || "Unknown",
      leadPhone: lead?.phone ?? "",
      tier: lead?.tier ?? "cold",
      score: lead?.score ?? 0,
      courseInterest: lead?.courseInterest ?? "",
      status: lead?.status ?? "new",
    };
  });
}
