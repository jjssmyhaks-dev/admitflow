import { NextRequest, NextResponse } from "next/server";
import { dueFollowups, recordFollowup } from "@/lib/nurture";

// Cron-able endpoint (Cloud Scheduler / Inngest): computes today's due
// follow-ups per tenant and records them. Message delivery wires to the
// WhatsApp BSP in the same pass.
export async function POST(req: NextRequest) {
  const tenantId = (await req.json().catch(() => ({})))?.tenantId
    ?? req.nextUrl.searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const due = await dueFollowups(tenantId);
  const sent = [];
  for (const f of due) sent.push(await recordFollowup(tenantId, f));
  return NextResponse.json({ due: due.length, sent });
}

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });
  const due = await dueFollowups(tenantId);
  return NextResponse.json({ due });
}
