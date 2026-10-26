import { NextRequest, NextResponse } from "next/server";
import { getRepo, uid } from "@/lib/repo";

export async function POST(req: NextRequest) {
  const { tenantId, conversationId, content, approved } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: "content required" }, { status: 400 });
  const repo = await getRepo();
  const conv = await repo.getConversation(tenantId, conversationId);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date().toISOString();
  await repo.addMessage({
    id: uid(),
    conversationId,
    tenantId,
    role: "counselor",
    content: content.trim(),
    sources: [],
    createdAt: now,
  });
  conv.lastActivityAt = now;
  await repo.upsertConversation(conv);

  await repo.addAudit({
    id: uid(),
    tenantId,
    actor: "counselor",
    action: approved ? "reply.approved" : "reply.sent",
    detail: approved
      ? "Approved the AI suggested reply"
      : `Sent counselor reply: "${content.trim().slice(0, 80)}"`,
    sources: [],
    conversationId,
    createdAt: now,
  });

  const messages = await repo.listMessages(tenantId, conversationId);
  const leads = await repo.listLeads(tenantId);
  const conversations = await repo.listConversations(tenantId);
  const items = conversations.map((c) => {
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
  return NextResponse.json({ messages, items });
}
