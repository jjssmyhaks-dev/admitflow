import { NextRequest, NextResponse, after } from "next/server";
import { getRepo } from "@/lib/repo";
import { ingest, fetchUrlText, chunkText } from "@/lib/ingest";
import { processPending } from "@/lib/ocr";
import { ensureSeed } from "@/lib/seed";

/** Ingest, then (if the document needs another pass) let the async extraction
 *  worker finish it after the response has gone out. The scheduler at
 *  POST /api/knowledge/ocr picks up anything left behind. */
async function ingestAndSchedule(input: Parameters<typeof ingest>[0]) {
  const result = await ingest(input);
  if (result.doc.status === "processing") {
    const tenantId = result.doc.tenantId;
    try {
      after(() =>
        processPending(tenantId).catch((err) => console.error("async extraction failed", err)),
      );
    } catch (err) {
      console.error("after() unavailable — the OCR cron will pick this up", err);
    }
  }
  return result;
}

// POST: multipart file upload | { url } | { text, name }
export async function POST(req: NextRequest) {
  await ensureSeed();
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const tenantId = String(form.get("tenantId") ?? "");
      const file = form.get("file");
      const url = form.get("url") ? String(form.get("url")) : undefined;
      const pastedName = form.get("name") ? String(form.get("name")) : undefined;
      const pastedText = form.get("text") ? String(form.get("text")) : undefined;
      if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

      if (pastedText) {
        const result = await ingestAndSchedule({
          tenantId,
          name: pastedName || "Pasted notes",
          kind: "template",
          text: pastedText,
        });
        return NextResponse.json(result);
      }
      if (url) {
        const name = new URL(url).hostname + new URL(url).pathname;
        const result = await ingestAndSchedule({ tenantId, name, kind: "url", url });
        return NextResponse.json(result, { status: result.extracted ? 200 : 422 });
      }
      if (file && typeof file !== "string") {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const ext = file.name.split(".").pop()?.toLowerCase();
        const kind = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : ext === "xlsx" || ext === "xls" ? "xlsx" : "template";
        const result = await ingestAndSchedule({
          tenantId,
          name: file.name,
          kind,
          file: { filename: file.name, bytes },
        });
        return NextResponse.json(result, { status: result.extracted ? 200 : 422 });
      }
      return NextResponse.json({ error: "file, url, or text required" }, { status: 400 });
    }

    const body = await req.json();
    const { tenantId, name, url, text } = body ?? {};
    if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    if (text) {
      return NextResponse.json(await ingestAndSchedule({ tenantId, name: name || "Pasted notes", kind: "template", text }));
    }
    if (url) {
      const result = await ingestAndSchedule({ tenantId, name, kind: "url", url });
      return NextResponse.json(result, { status: result.extracted ? 200 : 422 });
    }
    return NextResponse.json({ error: "nothing to ingest" }, { status: 400 });
  } catch (err) {
    console.error("knowledge ingest error", err);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  await ensureSeed();
  const tenantId = req.nextUrl.searchParams.get("tenant");
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });
  const repo = await getRepo();
  const docs = await repo.listKnowledge(tenantId);
  const topics = [...new Set(docs.flatMap((d) => d.topics))];
  return NextResponse.json({ docs, topics, expected: ["fees", "eligibility", "dates", "courses", "campus"] });
}

export async function DELETE(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenant");
  const docId = req.nextUrl.searchParams.get("doc");
  if (!tenantId || !docId) return NextResponse.json({ error: "tenant and doc required" }, { status: 400 });
  const repo = await getRepo();
  await repo.deleteKnowledge(tenantId, docId);
  return NextResponse.json({ ok: true });
}

// Exposed for tests: preview chunking of pasted text
export async function PUT(req: NextRequest) {
  const { text } = await req.json();
  return NextResponse.json({ chunks: chunkText(String(text ?? "")) });
}
