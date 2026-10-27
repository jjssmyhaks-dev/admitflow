"use client";

import { useState } from "react";
import type { DueFollowup } from "@/lib/nurture";
import type { Role } from "@/lib/types";
import { can } from "@/lib/roles";

export function NurtureClient({ tenantId, initialDue, role }: { tenantId: string; initialDue: DueFollowup[]; role: Role }) {
  const canRun = can(role, "write");
  const [due, setDue] = useState(initialDue);
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/nurture/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      setRan(data.due ?? data.results?.[tenantId]?.due ?? 0);
      setDue([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3>Due today</h3>
          <p className="panel-sub">
            {ran !== null
              ? `Run complete — ${ran} message${ran === 1 ? "" : "s"} logged to the audit trail.`
              : "Each run logs the send to the audit log; delivery goes through the WhatsApp BSP."}
          </p>
        </div>
        <button className="tines-button tines-button-solid" onClick={run} disabled={busy || !canRun}>
          {busy ? "Running…" : "Run nurture now"}
        </button>
      </div>

      <div className="table-wrap" style={{ border: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Phone</th>
              <th>Sequence</th>
              <th>Day</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {due.map((d, i) => (
              <tr key={`${d.leadId}-${d.dayOffset}-${i}`}>
                <td style={{ fontWeight: 600 }}>{d.leadName || "—"}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{d.phone}</td>
                <td>{d.sequenceName}</td>
                <td><span className={`pill pill-${d.tier}`}>+{d.dayOffset}d</span></td>
                <td style={{ fontSize: 13 }}>{d.message}</td>
              </tr>
            ))}
            {due.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted-foreground)" }}>
                  Nothing due today — sequences fire on each lead&apos;s anniversary offset.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
