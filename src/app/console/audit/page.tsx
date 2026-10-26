import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { fmtDateTime } from "@/lib/format";

const ACTOR_STYLE: Record<string, string> = {
  ai: "pill-warm",
  counselor: "pill-ok",
  system: "pill-cold",
  lead: "pill-hot",
};

export default async function AuditPage() {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const events = await repo.listAudit(session.orgId, 300);

  return (
    <>
      <div className="console-topbar">
        <div>
          <h1>Audit log</h1>
          <div className="sub">Every AI message, guardrail hit, handoff, and the sources used (PRD §6)</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Detail</th>
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={{ fontSize: 12.5, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                  {fmtDateTime(e.createdAt)}
                </td>
                <td>
                  <span className={`pill ${ACTOR_STYLE[e.actor] ?? "pill-cold"}`}>{e.actor}</span>
                </td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{e.action}</td>
                <td>{e.detail}</td>
                <td style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
                  {e.sources.length ? e.sources.join(", ") : "—"}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted-foreground)" }}>
                  No events yet. Test the sandbox to generate audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
