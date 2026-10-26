// Async extraction worker.
//
// The synchronous ingest pass (src/lib/ingest.ts) extracts text with
// zero-dependency parsers. Scanned PDFs, photographs and unusual encodings
// come back empty, so those documents are parked as `processing` with their
// raw upload stashed in R2 (see rawstore.ts). This module is what finishes
// them: it retries the fetch for URL imports, re-runs the local extractor,
// and — when an OCR provider is configured — sends the bytes to it.
//
// Trigger it from a scheduler (POST /api/knowledge/ocr) or from the ingest
// route, which schedules a run after the response has been sent.
//
//   OCR_API_KEY  required to enable OCR
//   OCR_API_URL  defaults to https://api.openai.com/v1/chat/completions;
//                any endpoint that takes { filename, mimeType, data } and
//                answers { text } works too
//   OCR_MODEL    defaults to gpt-4o-mini
import { getRepo, uid } from "@/lib/repo";
import { chunkText, extractText, fetchUrlText } from "@/lib/ingest";
import { deleteRaw, getRaw } from "@/lib/rawstore";
import type { KnowledgeDoc } from "@/lib/types";

const DEFAULT_OCR_URL = "https://api.openai.com/v1/chat/completions";
const MIN_TEXT = 40; // characters below which we treat OCR as having failed

export type OcrResult =
  | { ok: true; text: string }
  | { ok: false; retryable: boolean; error: string };

export function ocrConfigured(): boolean {
  return Boolean(process.env.OCR_API_KEY);
}

export function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    txt: "text/plain",
    csv: "text/csv",
  };
  return map[ext] ?? "application/octet-stream";
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Pulls plain text out of either our generic contract or an OpenAI-shaped body. */
function pickText(json: unknown): string {
  const j = json as Record<string, any>;
  if (typeof j?.text === "string") return j.text;
  if (typeof j?.output_text === "string") return j.output_text;
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p?.text ?? "").join("\n");
  return "";
}

/**
 * Sends one document to the OCR provider.
 * `retryable: false` means no amount of re-running will help (bad key, 4xx,
 * provider says the file is unusable) — the worker marks the doc `failed`.
 */
export async function ocrExtract(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<OcrResult> {
  const key = process.env.OCR_API_KEY;
  if (!key) {
    return { ok: false, retryable: false, error: "no OCR provider configured (set OCR_API_KEY)" };
  }
  const url = (process.env.OCR_API_URL || DEFAULT_OCR_URL).trim();
  const model = process.env.OCR_MODEL || "gpt-4o-mini";
  const data = base64(bytes);
  const openAiShape = /\/(chat\/completions|responses)\/?$/.test(url);

  const body = openAiShape
    ? {
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract every word of text from this document, in reading order. Output only the extracted text.",
              },
              mimeType.startsWith("image/")
                ? { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } }
                : {
                    type: "file",
                    file: { filename, file_data: `data:${mimeType};base64,${data}` },
                  },
            ],
          },
        ],
      }
    : { filename, mimeType, data, model };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return {
        ok: false,
        retryable: res.status >= 500 || res.status === 429,
        error: `OCR provider responded ${res.status}: ${detail}`,
      };
    }
    const text = pickText(await res.json());
    if (text.trim().length < MIN_TEXT) {
      return { ok: false, retryable: false, error: "OCR provider returned no usable text" };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, retryable: true, error: `OCR request failed: ${String(err).slice(0, 200)}` };
  }
}

/* -------------------------------- worker --------------------------------- */

export interface OcrRunSummary {
  tenantId: string;
  pending: number;
  ingested: string[];
  failed: { docId: string; name: string; reason: string }[];
  retrying: { docId: string; name: string; reason: string }[];
}

type Repo = Awaited<ReturnType<typeof getRepo>>;

async function markIngested(
  repo: Repo,
  doc: KnowledgeDoc,
  text: string,
  now: string,
  out: OcrRunSummary,
): Promise<void> {
  const chunks = chunkText(text);
  await repo.updateKnowledge(
    {
      ...doc,
      status: "ingested",
      chunkCount: chunks.length,
      topics: [...new Set(chunks.flatMap((c) => c.topics))],
      updatedAt: now,
    },
    chunks.map((c) => ({ docId: doc.id, tenantId: doc.tenantId, content: c.content, topics: c.topics })),
  );
  await repo.addAudit({
    id: uid(),
    tenantId: doc.tenantId,
    actor: "system",
    action: "knowledge.ocr",
    detail: `Async extraction finished "${doc.name}" (${chunks.length} chunks)`,
    sources: [doc.name],
    createdAt: now,
  });
  out.ingested.push(doc.id);
}

async function markFailed(
  repo: Repo,
  doc: KnowledgeDoc,
  reason: string,
  now: string,
  out: OcrRunSummary,
): Promise<void> {
  await repo.updateKnowledge({ ...doc, status: "failed", updatedAt: now }, []);
  await repo.addAudit({
    id: uid(),
    tenantId: doc.tenantId,
    actor: "system",
    action: "knowledge.failed",
    detail: `Async extraction gave up on "${doc.name}": ${reason}`,
    sources: [doc.name],
    createdAt: now,
  });
  await deleteRaw(doc.tenantId, doc.id);
  out.failed.push({ docId: doc.id, name: doc.name, reason });
}

/**
 * Drains every `processing` document for a tenant.
 * Transient problems (network, provider 5xx) stay `processing` so the next
 * run retries them; everything else reaches a terminal state, so nothing sits
 * in `processing` forever.
 */
export async function processPending(tenantId: string): Promise<OcrRunSummary> {
  const repo = await getRepo();
  const docs = (await repo.listKnowledge(tenantId)).filter((d) => d.status === "processing");
  const out: OcrRunSummary = { tenantId, pending: docs.length, ingested: [], failed: [], retrying: [] };

  for (const doc of docs) {
    const now = new Date().toISOString();

    // URL imports: re-fetch rather than OCR.
    if (doc.kind === "url") {
      const raw = await getRaw(tenantId, doc.id);
      const url = raw ? new TextDecoder().decode(raw).trim() : "";
      if (!url) {
        await markFailed(repo, doc, "the original URL was not stored — re-import the page", now, out);
        continue;
      }
      const res = await fetchUrlText(url);
      if (res.ok) {
        await markIngested(repo, doc, res.text, now, out);
      } else {
        out.retrying.push({ docId: doc.id, name: doc.name, reason: `could not fetch ${url}` });
      }
      continue;
    }

    const bytes = await getRaw(tenantId, doc.id);
    if (!bytes) {
      await markFailed(repo, doc, "the original upload is not stored — re-upload the file", now, out);
      continue;
    }

    // Cheap first shot: the local extractor may succeed now (e.g. it was
    // improved since this document was uploaded).
    const local = await extractText(doc.name, bytes);
    if (local.ok) {
      await markIngested(repo, doc, local.text, now, out);
      continue;
    }

    if (!ocrConfigured()) {
      await markFailed(
        repo,
        doc,
        "needs OCR and no provider is configured (set OCR_API_KEY)",
        now,
        out,
      );
      continue;
    }

    const ocr = await ocrExtract(bytes, doc.name, mimeFor(doc.name));
    if (ocr.ok) {
      await markIngested(repo, doc, ocr.text, now, out);
    } else if (ocr.retryable) {
      out.retrying.push({ docId: doc.id, name: doc.name, reason: ocr.error });
    } else {
      await markFailed(repo, doc, ocr.error, now, out);
    }
  }

  return out;
}
