import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { requireTenant } from "@/lib/authz";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireTenant(req.nextUrl.searchParams.get("tenant"), "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.tenantId;
  const repo = await getRepo();
  const conv = await repo.getConversation(tenantId, id);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = await repo.listMessages(tenantId, id);
  return NextResponse.json({ messages, summary: conv.summary ?? "" });
}
