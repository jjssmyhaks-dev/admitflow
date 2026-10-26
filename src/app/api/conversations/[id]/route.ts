import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = req.nextUrl.searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });
  const repo = await getRepo();
  const conv = await repo.getConversation(tenantId, id);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = await repo.listMessages(tenantId, id);
  return NextResponse.json({ messages, summary: conv.summary ?? "" });
}
