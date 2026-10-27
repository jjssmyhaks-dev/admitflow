"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";
import { can } from "@/lib/roles";

/** CSV lead import next to the export button on the Leads page. */
export function LeadImport({ tenantId, role }: { tenantId: string; role: Role }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const allowed = can(role, "write");

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.set("tenantId", tenantId);
      form.set("file", file);
      const res = await fetch("/api/import/leads", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(`❌ ${data.error ?? `import failed (${res.status})`}`);
      } else {
        setNote(
          `✅ Imported ${data.imported} lead${data.imported === 1 ? "" : "s"}` +
            (data.skipped ? `, skipped ${data.skipped}` : "") +
            (data.truncated ? " (file truncated at 500 rows)" : ""),
        );
        router.refresh();
      }
    } catch (err) {
      setNote(`❌ ${String(err).slice(0, 140)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <label
        className="tines-button tines-button-outline"
        style={{
          cursor: allowed && !busy ? "pointer" : "not-allowed",
          opacity: allowed ? 1 : 0.5,
        }}
        title={allowed ? "Import leads from a CSV file" : "Your role cannot import leads"}
      >
        {busy ? "Importing…" : "Import CSV"}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          disabled={!allowed || busy}
          onChange={pick}
        />
      </label>
      {note && <span style={{ fontSize: 13 }}>{note}</span>}
    </span>
  );
}
