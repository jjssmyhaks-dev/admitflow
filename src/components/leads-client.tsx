"use client";

import { useMemo, useState } from "react";
import type { Lead } from "@/lib/types";
import { fmtDate } from "@/lib/format";

const FILTERS = ["all", "hot", "warm", "cold", "opted_out"] as const;

export function LeadsClient({ initialLeads }: { initialLeads: Lead[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    return initialLeads.filter((l) => {
      if (filter === "opted_out" && !l.optedOut) return false;
      if (["hot", "warm", "cold"].includes(filter) && l.tier !== filter) return false;
      if (q) {
        const hay = `${l.name} ${l.phone} ${l.city ?? ""} ${l.courseInterest ?? ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [initialLeads, filter, q]);

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            className="step-chip"
            style={{
              cursor: "pointer",
              ...(filter === f
                ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }
                : {}),
            }}
            onClick={() => setFilter(f)}
          >
            {f.replace("_", " ")}
          </button>
        ))}
        <input
          className="input"
          style={{ maxWidth: 260, marginLeft: "auto" }}
          placeholder="Search name, phone, course…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Phone</th>
              <th>Course interest</th>
              <th>City</th>
              <th>Score</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Channel</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td style={{ fontWeight: 600 }}>{l.name || "—"}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{l.phone}</td>
                <td>{l.courseInterest || "—"}</td>
                <td>{l.city || "—"}</td>
                <td style={{ fontWeight: 600 }}>{l.score}</td>
                <td>
                  <span className={`pill pill-${l.tier}`}>{l.tier}</span>
                </td>
                <td style={{ textTransform: "capitalize", fontSize: 13 }}>
                  {l.optedOut ? <span className="pill pill-hot">opted out</span> : l.status.replace("_", " ")}
                </td>
                <td style={{ textTransform: "capitalize", fontSize: 13 }}>{l.source.replace("_", " ")}</td>
                <td style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
                  {fmtDate(l.updatedAt)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} style={{ color: "var(--muted-foreground)" }}>
                  No leads match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
