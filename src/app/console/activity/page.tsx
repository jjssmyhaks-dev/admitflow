import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { dueFollowups } from "@/lib/nurture";
import { getRepo } from "@/lib/repo";
import { NurtureClient } from "@/components/nurture-client";

export default async function NurturePage() {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const [due, settings] = await Promise.all([
    dueFollowups(session.orgId),
    repo.getSettings(session.orgId),
  ]);

  return (
    <>
      <div className="console-topbar">
        <div>
          <h1>Nurture queue</h1>
          <div className="sub">Follow-ups due today · STOP honored · sequences configurable in Agent rules</div>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {settings.sequences.map((seq) => (
          <div className="stat" key={seq.id}>
            <div className="label">{seq.tier} sequence</div>
            <div className="value">{seq.steps.length}</div>
            <div className="delta">{seq.enabled ? `${seq.name} · enabled` : "disabled"}</div>
          </div>
        ))}
      </div>

      <NurtureClient tenantId={session.orgId} initialDue={due} role={session.role} />
    </>
  );
}
