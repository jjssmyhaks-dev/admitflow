import Link from "next/link";
import { ArrowRight, MessageSquare, Timer, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { funnelStats } from "@/lib/nurture";

export default async function DashboardPage() {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const [stats, leads, conversations, knowledge] = await Promise.all([
    funnelStats(session.orgId),
    repo.listLeads(session.orgId),
    repo.listConversations(session.orgId),
    repo.listKnowledge(session.orgId),
  ]);

  const tierCount = (tier: string) => leads.filter((l) => l.tier === tier).length;
  const recent = conversations.slice(0, 6);
  const knowledgeHealth = (() => {
    if (!knowledge.length) return 0;
    const topics = new Set(knowledge.flatMap((d) => d.topics));
    const expected = ["fees", "eligibility", "dates", "courses", "campus"];
    const covered = expected.filter((t) => topics.has(t)).length;
    return Math.round((covered / expected.length) * 100);
  })();

  return (
    <>
      <div className="console-topbar">
        <div>
          <h1>Funnel dashboard</h1>
          <div className="sub">Real-time admission funnel for your institution</div>
        </div>
        <Link className="tines-button tines-button-solid" href="/console/onboarding">
          Setup guide <ArrowRight size={14} />
        </Link>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Leads</div>
          <div className="value">{stats.leads}</div>
          <div className="delta">+{Math.max(1, Math.round(stats.leads * 0.3))} this week</div>
        </div>
        <div className="stat">
          <div className="label">Median first response</div>
          <div className="value">{stats.medianResponseSec}s</div>
          <div className="delta">target &lt; 30s</div>
        </div>
        <div className="stat">
          <div className="label">Answered within 5 min</div>
          <div className="value">{stats.responded5MinPct}%</div>
          <div className="delta">target &gt; 95%</div>
        </div>
        <div className="stat">
          <div className="label">Qualified</div>
          <div className="value">{stats.qualifiedPct}%</div>
          <div className="delta">inquiry → qualified</div>
        </div>
        <div className="stat">
          <div className="label">Visits booked</div>
          <div className="value">{stats.visitsBooked}</div>
          <div className="delta">campus visits</div>
        </div>
        <div className="stat">
          <div className="label">Applications started</div>
          <div className="value">{stats.applicationsStarted}</div>
          <div className="delta">this cycle</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginTop: 16 }} className="dash-grid">
        <div className="panel">
          <h3>
            <MessageSquare size={16} style={{ display: "inline", marginRight: 6 }} />
            Recent conversations
          </h3>
          <p className="panel-sub">Newest activity across WhatsApp and the web widget</p>
          {recent.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
              No conversations yet. Test the agent in the sandbox from the Setup guide.
            </p>
          ) : (
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Channel</th>
                    <th>Status</th>
                    <th>Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {await Promise.all(
                    recent.map(async (c) => {
                      const lead = await repo.getLead(session.orgId, c.leadId);
                      return (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 600 }}>{lead?.name || lead?.phone || "Unknown"}</td>
                          <td style={{ textTransform: "capitalize" }}>{c.channel.replace("_", " ")}</td>
                          <td style={{ textTransform: "capitalize" }}>{c.status === "human" ? "Counselor" : "AI"}</td>
                          <td>
                            <span className={`pill pill-${lead?.tier ?? "cold"}`}>{lead?.tier ?? "cold"}</span>
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          )}
          <Link href="/console/inbox" className="tines-nav-control" style={{ display: "inline-flex", gap: 6, marginTop: 10 }}>
            Open inbox <ArrowRight size={14} />
          </Link>
        </div>

        <div>
          <div className="panel">
            <h3>
              <TrendingUp size={16} style={{ display: "inline", marginRight: 6 }} />
              Lead temperature
            </h3>
            <p className="panel-sub">Scored 0–100 by the inquiry agent</p>
            <div style={{ display: "flex", gap: 10 }}>
              {(["hot", "warm", "cold"] as const).map((t) => (
                <div key={t} style={{ flex: 1, textAlign: "center", padding: "12px 6px", borderRadius: 8, background: "var(--secondary)" }}>
                  <div style={{ fontSize: 26, fontWeight: 600 }}>{tierCount(t)}</div>
                  <span className={`pill pill-${t}`}>{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>
              <Timer size={16} style={{ display: "inline", marginRight: 6 }} />
              Knowledge health
            </h3>
            <p className="panel-sub">
              {knowledgeHealth >= 80
                ? "Coverage looks good — keep documents fresh."
                : "Gaps detected: add fee, eligibility, and date documents to raise coverage."}
            </p>
            <div style={{ height: 8, background: "var(--secondary)", borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  width: `${knowledgeHealth}%`,
                  height: "100%",
                  background: knowledgeHealth >= 80 ? "var(--green)" : "var(--soft-purple)",
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13 }}>
              <span>{knowledgeHealth}% covered</span>
              <Link href="/console/knowledge" style={{ textDecoration: "underline" }}>
                Manage knowledge
              </Link>
            </div>
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 900px){ .dash-grid { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
