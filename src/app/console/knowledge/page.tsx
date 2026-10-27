import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { KNOWLEDGE_TOPICS } from "@/lib/ingest";
import { KnowledgeClient } from "@/components/knowledge-client";

export default async function KnowledgePage() {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const docs = await repo.listKnowledge(session.orgId);

  const covered = new Set(docs.flatMap((d) => d.topics));
  const expected = ["fees", "eligibility", "dates", "courses", "campus"];
  const missing = expected.filter((t) => !covered.has(t));
  const health = Math.round(((expected.length - missing.length) / expected.length) * 100);

  return (
    <>
      <div className="console-topbar">
        <div>
          <h1>Knowledge base</h1>
          <div className="sub">Versioned ingestion from PDF, DOCX, XLSX, URL, or a guided template</div>
        </div>
        <span className={`pill ${health >= 80 ? "pill-ok" : "pill-warm"}`}>Knowledge health {health}%</span>
      </div>

      {missing.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--peach)" }}>
          <h3>⚠ Gap detection</h3>
          <p className="panel-sub" style={{ marginBottom: 0 }}>
            No approved content for: <strong>{missing.join(", ")}</strong>. The agent will fall back to a
            counselor for these topics until you add documents.
          </p>
        </div>
      )}

      <KnowledgeClient
        tenantId={session.orgId}
        role={session.role}
        initialDocs={docs}
        topics={KNOWLEDGE_TOPICS}
        covered={[...covered]}
        expected={expected}
      />
    </>
  );
}
