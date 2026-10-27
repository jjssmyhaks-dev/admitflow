// Re-index an existing document from its stored original (R2 raw store):
// re-fetch the URL or re-extract the parked bytes, re-chunk, bump the
// version. Used after fixing extraction settings or rotating the OCR key.
import { NextRequest, NextResponse } from "next/server";
import { getRepo, uid } from "@/lib/repo";
import { chunkText, extractText, fetchUrlText, tagTopics } from "@/lib/ingest";
import { requireTenant } from "@/lib/authz";
import { embedTexts } from "@/lib/embed";
import { getRaw } from "@/lib/rawstore";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { tenantId?: string; docId?: string };
  const auth = await requireTenant(body.tenantId, "write");
  if (!auth.ok) return auth.response;
  const tenantId = auth.tenantId;
  if (!body.docId) return NextResponse.json({ error: "docId required" }, { status: 400 });

  const repo = await getRepo();
  const docs = await repo.listKnowledge(tenantId);
  const doc = docs.find((d) => d.id === body.docId);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const raw = await getRaw(tenantId, doc.id);
  if (!raw) {
    return NextResponse.json(
      { error: "The original source for this document is no longer stored — upload it again." },
      { status: 404 },
    );
  }

  const extracted =
    doc.kind === "url"
      ? await fetchUrlText(new TextDecoder().decode(raw).trim())
      : await extractText(doc.name, raw);
  if (!extracted.ok || !extracted.text.trim()) {
    return NextResponse.json(
      { error: "Extraction failed again — check OCR settings or upload a text-based file." },
      { status: 422 },
    );
  }

  const parts = chunkText(extracted.text);
  const vecs = await embedTexts(parts.map((p) => p.content));
  const now = new Date().toISOString();
  const updated = {
    ...doc,
    status: "ingested" as const,
    version: doc.version + 1,
    updatedAt: now,
    chunkCount: parts.length,
    topics: tagTopics(extracted.text),
  };
  await repo.updateKnowledge(
    updated,
    parts.map((p, i) => ({
      docId: doc.id,
      tenantId,
      content: p.content,
      topics: p.topics,
      embedding: vecs?.[i] ?? null,
    })),
  );
  await repo.addAudit({
    id: uid(),
    tenantId,
    actor: "counselor",
    action: "knowledge.reindexed",
    detail: `Re-indexed "${doc.name}" → v${updated.version} (${parts.length} chunks)`,
    sources: [doc.name],
    createdAt: now,
  });

  return NextResponse.json({ doc: updated, chunks: parts.length });
}
