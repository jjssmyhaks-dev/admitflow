import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { InboxView } from "@/components/inbox-view";

export default async function InboxPage() {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const [conversations, leads] = await Promise.all([
    repo.listConversations(session.orgId),
    repo.listLeads(session.orgId),
  ]);

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

  return (
    <>
      <div className="console-topbar">
        <div>
          <h1>Counselor inbox</h1>
          <div className="sub">Sorted by score and urgency · AI pauses when you take over</div>
        </div>
      </div>
      <InboxView initialItems={items} tenantId={session.orgId} />
    </>
  );
}
