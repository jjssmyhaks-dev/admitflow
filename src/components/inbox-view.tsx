"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Conversation, Lead } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";

export interface InboxItem {
  conversation: Conversation;
  leadName: string;
  leadPhone: string;
  tier: Lead["tier"];
  score: number;
  courseInterest: string;
  status: Lead["status"];
}

interface ThreadMsg {
  id: string;
  role: "lead" | "ai" | "counselor" | "system";
  content: string;
  sources: string[];
  createdAt: string;
}

const OUTCOMES: { value: Lead["status"]; label: string }[] = [
  { value: "visit_booked", label: "Visit booked" },
  { value: "applied", label: "Applied" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_fit", label: "Wrong fit" },
  { value: "nurturing", label: "Keep nurturing" },
];

const TIER_ORDER: Record<string, number> = { hot: 0, warm: 1, cold: 2 };

export function InboxView({ initialItems, tenantId }: { initialItems: InboxItem[]; tenantId: string }) {
  const [items, setItems] = useState<InboxItem[]>(Array.isArray(initialItems) ? initialItems : []);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.conversation.id ?? null);
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [summary, setSummary] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () =>
      [...(Array.isArray(items) ? items : [])].sort(
        (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.score - a.score,
      ),
    [items],
  );
  const selected = sorted.find((i) => i.conversation.id === selectedId) ?? null;

  const loadThread = useCallback(async (convId: string) => {
    const res = await fetch(`/api/conversations/${convId}?tenant=${tenantId}`);
    if (res.ok) {
      const data = await res.json();
      setThread(Array.isArray(data.messages) ? data.messages : []);
      setSummary(data.summary ?? "");
    }
  }, [tenantId]);

  useEffect(() => {
    if (selectedId) void loadThread(selectedId);
  }, [selectedId, loadThread]);

  async function action(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        // Never trust the shape blindly — a bad payload must not crash the inbox.
        if (Array.isArray(data.items)) setItems(data.items);
        if (Array.isArray(data.messages)) setThread(data.messages);
        return data;
      }
    } finally {
      setBusy(false);
    }
    return null;
  }

  const takeOver = () =>
    selected &&
    action("/api/conversations/takeover", {
      tenantId,
      conversationId: selected.conversation.id,
      leadId: selected.conversation.leadId,
    });

  const approveReply = async () => {
    if (!selected) return;
    const suggested =
      thread.filter((m) => m.role === "ai").slice(-1)[0]?.content ??
      "Thanks for your interest! A counselor will help you with the next steps.";
    await action("/api/conversations/reply", {
      tenantId,
      conversationId: selected.conversation.id,
      content: suggested,
      approved: true,
    });
    setDraft("");
  };

  const sendReply = async () => {
    if (!selected || !draft.trim()) return;
    await action("/api/conversations/reply", {
      tenantId,
      conversationId: selected.conversation.id,
      content: draft.trim(),
    });
    setDraft("");
  };

  const markOutcome = (status: Lead["status"]) =>
    selected &&
    action("/api/conversations/outcome", {
      tenantId,
      leadId: selected.conversation.leadId,
      conversationId: selected.conversation.id,
      status,
    });

  const aiSuggestion = useMemo(() => {
    const last = [...thread].reverse().find((m) => m.role === "ai");
    const lastLead = [...thread].reverse().find((m) => m.role === "lead");
    if (!lastLead) return null;
    return last?.content ?? null;
  }, [thread]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16 }} className="inbox-grid">
      {/* List */}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>
          {sorted.length} conversations
        </div>
        <div style={{ maxHeight: 620, overflowY: "auto" }}>
          {sorted.map((item) => (
            <button
              key={item.conversation.id}
              onClick={() => setSelectedId(item.conversation.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "12px 16px",
                border: 0,
                borderBottom: "1px solid var(--border)",
                background: item.conversation.id === selectedId ? "var(--accent)" : "transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{item.leadName}</strong>
                <span className={`pill pill-${item.tier}`}>{item.score}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 4 }}>
                {item.courseInterest || "Course not captured"} · {item.conversation.status === "human" ? "🧑 Counselor" : "🤖 AI"}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                {fmtDateTime(item.conversation.lastActivityAt)}
              </div>
            </button>
          ))}
          {sorted.length === 0 && (
            <p style={{ padding: 16, fontSize: 14, color: "var(--muted-foreground)" }}>No conversations yet.</p>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="panel" style={{ padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selected ? (
          <p style={{ padding: 24, color: "var(--muted-foreground)" }}>Select a conversation.</p>
        ) : (
          <>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>{selected.leadName}</strong>{" "}
                <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{selected.leadPhone}</span>
                <div style={{ fontSize: 13, marginTop: 2 }}>
                  {selected.courseInterest} · <span className={`pill pill-${selected.tier}`}>{selected.tier} · {selected.score}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selected.conversation.status === "ai" ? (
                  <button className="tines-button tines-button-outline" disabled={busy} onClick={takeOver}>
                    Take over
                  </button>
                ) : (
                  <span className="pill pill-ok">Human mode — AI paused</span>
                )}
              </div>
            </div>

            {summary && (
              <div style={{ padding: "10px 18px", background: "var(--secondary)", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
                <strong>AI summary:</strong> {summary}
              </div>
            )}

            <div className="chat-body" style={{ minHeight: 300, maxHeight: 380 }}>
              {thread.map((m) => (
                <div key={m.id} className={`chat-msg ${m.role === "lead" ? "lead" : "agent"}`}>
                  <span style={{ opacity: 0.7, fontSize: 11, display: "block", marginBottom: 3 }}>
                    {m.role === "counselor" ? "You (counselor)" : m.role === "ai" ? "AI agent" : m.role === "system" ? "System" : selected.leadName}
                  </span>
                  {m.content}
                  {m.sources?.length ? <span className="sources">Sources: {m.sources.join(", ")}</span> : null}
                </div>
              ))}
              {thread.length === 0 && <p style={{ color: "var(--muted-foreground)", fontSize: 14 }}>Loading…</p>}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
              {aiSuggestion && selected.conversation.status === "ai" && (
                <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", flex: 1, minWidth: 180 }}>
                    Suggested reply: “{aiSuggestion.slice(0, 90)}…”
                  </span>
                  <button className="tines-button tines-button-solid" disabled={busy} onClick={approveReply}>
                    Approve suggested reply
                  </button>
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  placeholder="Type a reply as counselor…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendReply()}
                />
                <button className="tines-button tines-button-solid" disabled={busy || !draft.trim()} onClick={sendReply}>
                  Send
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", alignSelf: "center" }}>Mark outcome:</span>
                {OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    className="step-chip"
                    disabled={busy}
                    style={{ cursor: "pointer" }}
                    onClick={() => markOutcome(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`@media (max-width: 1000px){ .inbox-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
