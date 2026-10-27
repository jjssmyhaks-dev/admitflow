"use client";

import { useState } from "react";
import type { AgentSettings, NurtureSequence, Role } from "@/lib/types";
import { can } from "@/lib/roles";

export function RulesClient({ initial, role }: { initial: AgentSettings; role: Role }) {
  const canManage = can(role, "manage");
  const [s, setS] = useState<AgentSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      if (res.ok) setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  const listField = (key: "neverAnswer" | "escalationTriggers") => (
    <div className="field">
      <label>{key === "neverAnswer" ? "Topics the AI must never answer" : "Escalation triggers"}</label>
      {s[key].map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input
            className="input"
            value={item}
            onChange={(e) => {
              const next = [...s[key]];
              next[i] = e.target.value;
              setS({ ...s, [key]: next });
            }}
          />
          <button
            className="tines-nav-control"
            onClick={() => setS({ ...s, [key]: s[key].filter((_, j) => j !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="tines-button tines-button-outline"
        onClick={() => setS({ ...s, [key]: [...s[key], ""] })}
      >
        Add rule
      </button>
    </div>
  );

  const setSeq = (id: string, patch: Partial<NurtureSequence>) =>
    setS({
      ...s,
      sequences: s.sequences.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="panel">
        <h3>Voice &amp; availability</h3>
        <p className="panel-sub">How the agent speaks and when humans take over.</p>
        <div className="field">
          <label>Tone</label>
          <textarea className="textarea" rows={2} value={s.tone} onChange={(e) => setS({ ...s, tone: e.target.value })} />
        </div>
        <div className="field">
          <label>Working hours for human handoff</label>
          <input className="input" value={s.workingHours} onChange={(e) => setS({ ...s, workingHours: e.target.value })} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="field">
            <label>Hot threshold (score ≥)</label>
            <input className="input" type="number" min={50} max={95} value={s.hotThreshold}
              onChange={(e) => setS({ ...s, hotThreshold: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Warm threshold (score ≥)</label>
            <input className="input" type="number" min={10} max={69} value={s.warmThreshold}
              onChange={(e) => setS({ ...s, warmThreshold: Number(e.target.value) })} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Guardrails</h3>
        <p className="panel-sub">Hard limits checked before every answer (PRD §6 guardrails).</p>
        {listField("neverAnswer")}
        {listField("escalationTriggers")}
      </div>

      <div className="panel">
        <h3>Nurture sequences</h3>
        <p className="panel-sub">Multi-touch follow-ups run until applied, declined, or STOP (agent 2).</p>
        {s.sequences.map((seq) => (
          <div key={seq.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong>{seq.name}</strong>
              <span className={`pill pill-${seq.tier}`}>{seq.tier}</span>
            </div>
            <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={seq.enabled}
                onChange={(e) => setSeq(seq.id, { enabled: e.target.checked })}
              />
              Enabled
            </label>
            {seq.steps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <span className="step-chip" style={{ whiteSpace: "nowrap", alignSelf: "center" }}>
                  day {step.dayOffset}
                </span>
                <input
                  className="input"
                  value={step.message}
                  onChange={(e) => {
                    const steps = seq.steps.map((st, j) => (j === i ? { ...st, message: e.target.value } : st));
                    setSeq(seq.id, { steps });
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="tines-button tines-button-solid" onClick={save} disabled={busy || !canManage}>
          {busy ? "Saving…" : "Save rules"}
        </button>
        {saved && <span className="pill pill-ok">Saved</span>}
        {!canManage && <span className="hint">Only admins and owners can change agent rules.</span>}
      </div>
    </div>
  );
}
