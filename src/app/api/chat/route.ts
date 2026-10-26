import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleInquiry } from "@/lib/agent";
import { ensureSeed } from "@/lib/seed";
import { getRepo } from "@/lib/repo";

// The website widget runs on the customer's domain — allow cross-origin POSTs.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const Body = z.object({
  tenantId: z.string().min(1),
  text: z.string().min(1).max(2000),
  channel: z.enum(["whatsapp", "web_widget", "lead_form", "manual"]).default("web_widget"),
  conversationId: z.string().optional(),
  leadPhone: z.string().optional(),
});

export async function POST(req: NextRequest) {
  await ensureSeed();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  // Unknown tenant → 404 (never create tenants from public traffic).
  const repo = await getRepo();
  if (!(await repo.getTenant(parsed.data.tenantId))) {
    return NextResponse.json({ error: "unknown tenant" }, { status: 404, headers: CORS_HEADERS });
  }
  try {
    const result = await handleInquiry(parsed.data);
    return NextResponse.json(result, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("chat error", err);
    return NextResponse.json({ error: "agent failed" }, { status: 500, headers: CORS_HEADERS });
  }
}
