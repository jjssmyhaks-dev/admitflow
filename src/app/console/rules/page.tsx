import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { RulesClient } from "@/components/rules-client";

export default async function RulesPage() {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const settings = await repo.getSettings(session.orgId);

  return (
    <>
      <div className="console-topbar">
        <div>
          <h1>Agent rules</h1>
          <div className="sub">Tone, working hours, forbidden topics, escalation, nurture sequences</div>
        </div>
      </div>
      <RulesClient initial={settings} />
    </>
  );
}
