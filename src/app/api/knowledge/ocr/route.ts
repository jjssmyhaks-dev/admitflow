import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { ocrConfigured, processPending } from "@/lib/ocr";

// Async extraction trigger — drain every `processing` document for one tenant.
// Point a scheduler at it (POST from a cron) or call it from the console:
//   POST { tenantId, secret? }   header: X-Webhook-Secret
//   GET  ?tenant=<id>            header: X-Webhook-Secret
// The ingest route also schedules a run right after an upload that needs it.

async function secretOk(req: NextRequest, fromBody?: string): Promise<boolean> {
  const expected = process.env.OCR_RUN_SECRET || process.env.LEAD_WEBHOOK_SECRET || "change-me";
  const header = req.headers.get("x-webhook-secret") ?? undefined;
  return (fromBody ?? header) === expected;
}

async function respond(req: NextRequest, tenantId: string | null, secret?: string) {
  if (!(await secretOk(req, secret))) {
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const repo = await getRepo();
  if (!(await repo.getTenant(tenantId))) {
    return NextResponse.json({ error: "unknown tenant" }, { status: 404 });
  }

  const summary = await processPending(tenantId);
  return NextResponse.json({ ok: true, ocr: ocrConfigured(), ...summary });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return respond(
    req,
    (body as { tenantId?: string } | null)?.tenantId ?? null,
    (body as { secret?: string } | null)?.secret,
  );
}

export async function GET(req: NextRequest) {
  return respond(req, req.nextUrl.searchParams.get("tenant"));
}
