import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export default async function OnboardingPage() {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const [tenant, knowledge, leads] = await Promise.all([
    repo.getTenant(session.orgId),
    repo.listKnowledge(session.orgId),
    repo.listLeads(session.orgId),
  ]);

  return (
    <>
      <div className="console-topbar">
        <div>
          <h1>Setup guide</h1>
          <div className="sub">Three screens to value — target: live in under 60 minutes</div>
        </div>
      </div>
      <OnboardingWizard
        tenantId={session.orgId}
        tenant={tenant}
        docCount={knowledge.length}
        knowledgeTopics={[...new Set(knowledge.flatMap((d) => d.topics))]}
        leadCount={leads.length}
      />
    </>
  );
}
