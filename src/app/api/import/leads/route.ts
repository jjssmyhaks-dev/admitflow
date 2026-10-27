// CSV lead import — the mirror of /api/export/leads.
// Columns (header row, case-insensitive): name, phone (required), email,
// city, course, message. Rows run through the same agent pipeline as the
// lead-form webhook, so imports are de-duped by phone, slot-filled, scored
// and conversation-backed exactly like live leads.
import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { handleInquiry } from "@/lib/agent";
import { requireTenant } from "@/lib/authz";
import { limitOr429 } from "@/lib/ratelimit";
import { leadLimit } from "@/lib/limits";

const MAX_ROWS = 500;

/** Minimal RFC-4180-ish parser: quotes, escaped quotes, CRLF. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export async function POST(req: NextRequest) {
  const limited = limitOr429("lead-import", req, 5, 60_000);
  if (limited) return limited;

  const contentType = req.headers.get("content-type") ?? "";
  let csv = "";
  let requestedTenant: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    requestedTenant = form.get("tenantId") ? String(form.get("tenantId")) : null;
    const file = form.get("file");
    if (file && typeof file !== "string") {
      csv = await file.text();
    } else {
      csv = String(form.get("csv") ?? "");
    }
  } else {
    const body = (await req.json().catch(() => null)) as { tenantId?: string; csv?: string } | null;
    requestedTenant = body?.tenantId ?? null;
    csv = body?.csv ?? "";
  }

  const auth = await requireTenant(requestedTenant, "write");
  if (!auth.ok) return auth.response;
  const tenantId = auth.tenantId;

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return NextResponse.json(
      { error: "CSV needs a header row plus at least one data row" },
      { status: 400 },
    );
  }

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const idx = {
    name: col("name", "full_name"),
    phone: col("phone", "mobile", "whatsapp", "phone_number"),
    email: col("email"),
    city: col("city"),
    course: col("course", "course_interest", "interest"),
    message: col("message", "notes", "query"),
  };
  if (idx.phone < 0) {
    return NextResponse.json(
      { error: 'Missing "phone" column in the CSV header' },
      { status: 400 },
    );
  }

  const repo = await getRepo();

  // Plan cap: imports may not push a tenant past LEAD_LIMIT.
  const existingLeads = await repo.listLeads(tenantId);
  const remaining = leadLimit() - existingLeads.length;
  if (remaining <= 0) {
    return NextResponse.json(
      { error: `Lead limit reached (${leadLimit()}). Delete leads or upgrade the plan.` },
      { status: 429 },
    );
  }

  const dataRows = rows.slice(1, Math.min(MAX_ROWS, remaining) + 1);
  const results: { phone: string; leadId?: string; tier?: string; score?: number; error?: string }[] = [];
  let imported = 0;
  let skipped = 0;

  for (const row of dataRows) {
    const get = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
    const phone = get(idx.phone).replace(/[^\d+]/g, "");
    if (phone.replace(/\D/g, "").length < 6) {
      skipped++;
      results.push({ phone: get(idx.phone), error: "invalid phone" });
      continue;
    }
    const name = get(idx.name);
    const course = get(idx.course);
    const city = get(idx.city);
    const message = get(idx.message) || "Imported from CSV";

    try {
      const pieces = [
        message,
        name && `My name is ${name}`,
        course && `I am interested in ${course}`,
        city && `I am from ${city}`,
      ].filter(Boolean) as string[];

      const result = await handleInquiry({
        tenantId,
        channel: "manual",
        text: pieces.join(". "),
        leadPhone: phone,
        predefined: { name, course, city },
      });

      const email = get(idx.email);
      let lead = result.lead;
      if (email && lead.email !== email) {
        lead = await repo.upsertLead({ ...lead, email });
      }

      imported++;
      results.push({ phone, leadId: lead.id, tier: lead.tier, score: lead.score });
    } catch (err) {
      skipped++;
      results.push({ phone, error: String(err).slice(0, 160) });
    }
  }

  return NextResponse.json({
    imported,
    skipped,
    truncated: rows.length - 1 > MAX_ROWS,
    results,
  });
}
