import { requireSession } from "@/lib/session";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";
import { LeadsClient } from "@/components/leads-client";
import { LeadImport } from "@/components/lead-import";

export default async function LeadsPage() {
  const session = await requireSession();
  await ensureSeed();
  const repo = await getRepo();
  const leads = await repo.listLeads(session.orgId);

  return (
    <>
      <div className="console-topbar">
        <div>
          <h1>Leads</h1>
          <div className="sub">De-duplicated by phone · scored 0–100 · import & export CSV</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <LeadImport tenantId={session.orgId} role={session.role} />
          <a
            className="tines-button tines-button-solid"
            href={`/api/export/leads?tenant=${session.orgId}`}
          >
            Export CSV
          </a>
        </div>
      </div>
      <LeadsClient initialLeads={leads} />
    </>
  );
}
