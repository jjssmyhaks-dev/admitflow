"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import type { KnowledgeDoc, Role } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { can } from "@/lib/roles";
import { trackKnowledgeIngested } from "@/lib/analytics";

interface Props {
  tenantId: string;
  role: Role;
  initialDocs: KnowledgeDoc[];
  topics: string[];
  covered: string[];
  expected: string[];
}

export function KnowledgeClient({ tenantId, role, initialDocs, topics, covered, expected }: Props) {
  const canWrite = can(role, "write");
  const canManage = can(role, "manage");
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [tab, setTab] = useState<"file" | "url" | "paste">("file");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [pasteName, setPasteName] = useState("Guided FAQ template");
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<{
    id: string;
    chunks: { content: string; topics: string[] }[];
  } | null>(null);

  /** Show what was actually ingested for a document (click name again to close). */
  async function togglePreview(docId: string) {
    if (preview?.id === docId) {
      setPreview(null);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/knowledge?tenant=${tenantId}&doc=${docId}`);
      if (res.ok) {
        const data = await res.json();
        setPreview({ id: docId, chunks: Array.isArray(data.chunks) ? data.chunks : [] });
      }
    } finally {
      setBusy(false);
    }
  }

  /** Re-run extraction + chunking from the stored original. */
  async function reindex(docId: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/knowledge/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, docId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(`❌ ${data.error ?? `re-index failed (${res.status})`}`);
      } else {
        setNote(`✅ Re-indexed “${data.doc.name}” → v${data.doc.version} (${data.chunks} chunks)`);
        setDocs((ds) => ds.map((d) => (d.id === docId ? data.doc : d)));
        if (preview?.id === docId) setPreview(null);
      }
    } finally {
      setBusy(false);
    }
  }

  // Second activation step: an approved document is now in the knowledge base.
  function trackIngest(doc: KnowledgeDoc | undefined, nextDocCount: number) {
    trackKnowledgeIngested({
      sourceKind: doc?.kind ?? "template",
      topicCount: doc?.topics?.length ?? 0,
      docCount: nextDocCount,
    });
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.set("tenantId", tenantId);
      form.set("file", file);
      const res = await fetch("/api/knowledge", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        setNote(`✅ Ingested "${data.doc.name}" v${data.doc.version} — ${data.chunks} chunks, topics: ${data.doc.topics.join(", ") || "none"}`);
        setDocs((d) => [data.doc, ...d]);
        trackIngest(data.doc, docs.length + 1);
      } else {
        setNote(`⚠️ ${data.error ?? "Could not extract text from that file."} Try a text-based PDF/DOCX, or paste the content.`);
      }
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function submitUrl() {
    if (!url) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, url }),
      });
      const data = await res.json();
      if (res.ok) {
        setNote(`✅ Ingested ${url} — ${data.chunks} chunks.`);
        setDocs((d) => [data.doc, ...d]);
        setUrl("");
        trackIngest(data.doc, docs.length + 1);
      } else {
        setNote(`⚠️ ${data.error ?? "Could not read that URL."}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitPaste() {
    if (!pasteText.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.set("tenantId", tenantId);
      form.set("name", pasteName);
      form.set("text", pasteText);
      const res = await fetch("/api/knowledge", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        setNote(`✅ Ingested "${data.doc.name}" — ${data.chunks} chunks.`);
        setDocs((d) => [data.doc, ...d]);
        setPasteText("");
        trackIngest(data.doc, docs.length + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(docId: string) {
    setBusy(true);
    try {
      await fetch(`/api/knowledge?tenant=${tenantId}&doc=${docId}`, { method: "DELETE" });
      setDocs((d) => d.filter((x) => x.id !== docId));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <h3>Add knowledge</h3>
        <p className="panel-sub">The agent answers only from ingested, approved content. Each upload creates a new version.</p>
        <div className="steps">
          {(["file", "url", "paste"] as const).map((t) => (
            <button
              key={t}
              className={`step-chip ${tab === t ? "active" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => setTab(t)}
            >
              {t === "file" ? "Upload file" : t === "url" ? "Crawl URL" : "Guided template"}
            </button>
          ))}
        </div>

        {tab === "file" && (
          <div className="field">
            <label htmlFor="kb-file">PDF, DOCX, XLSX, TXT or MD</label>
            <input id="kb-file" className="input" type="file" accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv" onChange={uploadFile} disabled={busy || !canWrite} />
            <span className="hint">Fee structures, brochures, course lists, eligibility, FAQs.</span>
          </div>
        )}
        {tab === "url" && (
          <div className="field">
            <label htmlFor="kb-url">Page URL to crawl</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="kb-url" className="input" placeholder="https://yourcollege.edu/admissions" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="tines-button tines-button-solid" onClick={submitUrl} disabled={busy || !url || !canWrite}>
                Crawl
              </button>
            </div>
          </div>
        )}
        {tab === "paste" && (
          <>
            <div className="field">
              <label htmlFor="kb-name">Document name</label>
              <input id="kb-name" className="input" value={pasteName} onChange={(e) => setPasteName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="kb-text">Content (paste fee table, FAQ, eligibility rules…)</label>
              <textarea id="kb-text" className="textarea" rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"B.Tech tuition fee is INR 1,20,000 per year…\nAdmission requires 45% in 10+2 with PCM…"} />
            </div>
            <button className="tines-button tines-button-solid" onClick={submitPaste} disabled={busy || !pasteText.trim() || !canWrite}>
              Ingest
            </button>
          </>
        )}

        {note && <p style={{ fontSize: 13.5, marginTop: 12 }}>{note}</p>}
        {!canWrite && <p className="hint">Your role can view documents but not add or delete them.</p>}
      </div>

      <div className="panel">
        <h3>Ingested documents</h3>
        <p className="panel-sub">
          Topic coverage — {expected.map((t) => `${t}${covered.includes(t) ? " ✓" : " ✗"}`).join(" · ")}
        </p>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Version</th>
                <th>Chunks</th>
                <th>Topics</th>
                <th>Status</th>
                <th>Last updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <Fragment key={d.id}>
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>
                    <button
                      onClick={() => togglePreview(d.id)}
                      title="Preview the ingested content"
                      style={{
                        border: 0,
                        background: "none",
                        padding: 0,
                        font: "inherit",
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "left",
                        textDecoration: "underline",
                        textDecorationStyle: "dotted",
                        textUnderlineOffset: 3,
                      }}
                    >
                      {d.name}
                    </button>
                  </td>
                  <td style={{ textTransform: "uppercase", fontFamily: "var(--font-mono)", fontSize: 12 }}>{d.kind}</td>
                  <td>v{d.version}</td>
                  <td>{d.chunkCount}</td>
                  <td style={{ fontSize: 12.5 }}>{d.topics.join(", ") || "—"}</td>
                  <td>
                    <span className={`pill ${d.status === "ingested" ? "pill-ok" : d.status === "failed" ? "pill-hot" : "pill-warm"}`}>
                      {d.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{fmtDate(d.updatedAt)}</td>
                  <td>
                    {d.kind !== "template" && (
                      <button
                        className="tines-nav-control"
                        disabled={busy || !canWrite}
                        onClick={() => reindex(d.id)}
                        title="Re-run extraction from the stored original"
                        style={{ marginRight: 6 }}
                      >
                        Re-index
                      </button>
                    )}
                    <button className="tines-nav-control" disabled={busy || !canManage} onClick={() => remove(d.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
                {preview?.id === d.id && (
                  <tr>
                    <td colSpan={8} style={{ background: "var(--secondary)", fontSize: 13, padding: "10px 12px" }}>
                      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted-foreground)" }}>
                        Ingested content — {preview.chunks.length} chunk{preview.chunks.length === 1 ? "" : "s"}
                      </div>
                      {preview.chunks.length === 0 && (
                        <div style={{ color: "var(--muted-foreground)" }}>No chunks stored for this document.</div>
                      )}
                      {preview.chunks.map((c, i) => (
                        <div
                          key={i}
                          style={{
                            padding: "7px 0",
                            borderBottom: i < preview.chunks.length - 1 ? "1px dashed var(--border)" : "none",
                          }}
                        >
                          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 2 }}>
                            {c.topics.join(", ") || "untagged"}
                          </div>
                          {c.content}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted-foreground)" }}>
                    No documents yet — add your first one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 13, marginTop: 10, color: "var(--muted-foreground)" }}>
          All known topic tags: {topics.join(", ")}
        </p>
      </div>
    </>
  );
}
