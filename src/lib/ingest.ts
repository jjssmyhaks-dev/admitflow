// Knowledge ingestion (PRD §6): text extraction, chunking, topic tagging.
// Zero-dependency extractors for txt/md/csv, docx, xlsx and basic PDFs;
// anything unextractable is flagged "processing" for the OCR worker.
// Extraction uses only Web-standard APIs (DecompressionStream, TextDecoder)
// so the same code runs on Node and on the Cloudflare Workers runtime.
import { getRepo, uid } from "@/lib/repo";
import { putRaw } from "@/lib/rawstore";
import type { KnowledgeDoc } from "@/lib/types";

export type Extracted = { text: string; ok: boolean };

const TOPIC_RULES: { topic: string; re: RegExp }[] = [
  { topic: "fees", re: /\b(fee|fees|tuition|cost|price|installment|payment|₹|inr|rs\.?)\b/i },
  { topic: "eligibility", re: /\b(eligib|qualification|marks|requirement|criteria|age limit|10\+2|entrance)\b/i },
  { topic: "dates", re: /\b(deadline|last date|starts? on|opens? on|closing|schedule|calendar|session|november|january|february|august)\b/i },
  { topic: "courses", re: /\b(course|program|stream|branch|b\.?tech|m\.?tech|mba|bba|bca|science|commerce|humanities|class \d+)\b/i },
  { topic: "campus", re: /\b(campus|tour|visit|address|location|infrastructure|lab|library)\b/i },
  { topic: "transport", re: /\b(bus|transport|route|zone)\b/i },
  { topic: "hostel", re: /\b(hostel|mess|accommodation|sharing room)\b/i },
  { topic: "placement", re: /\b(placement|recruiter|package|salary|internship)\b/i },
];

export function tagTopics(text: string): string[] {
  return TOPIC_RULES.filter((t) => t.re.test(text)).map((t) => t.topic);
}

export function chunkText(text: string, max = 700): { content: string; topics: string[] }[] {
  const paras = text
    .replace(/\r/g, "")
    .split(/\n{2,}|\n|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((p) => p.trim())
    .filter((p) => p.length > 30);
  const chunks: { content: string; topics: string[] }[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + " " + p).length > max && buf) {
      chunks.push({ content: buf.trim(), topics: tagTopics(buf) });
      buf = p;
    } else {
      buf = buf ? `${buf} ${p}` : p;
    }
  }
  if (buf.trim()) chunks.push({ content: buf.trim(), topics: tagTopics(buf) });
  return chunks;
}

/* ----------------------------- extraction ------------------------------ */

const utf8 = new TextDecoder("utf-8");
const latin1 = new TextDecoder("latin1");

/** Inflate a zlib/deflate stream (ZIP entries and PDF FlateDecode streams). */
async function inflate(buf: Uint8Array): Promise<Uint8Array | null> {
  for (const format of ["deflate-raw", "deflate"] as const) {
    try {
      const stream = new Blob([new Uint8Array(buf)])
        .stream()
        .pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Not this format — try the next one.
    }
  }
  return null;
}

/** Minimal ZIP reader (docx/xlsx are ZIP containers). */
async function zipEntries(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (i + 4 <= buf.length && dv.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count && ptr + 46 <= buf.length; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOff = dv.getUint32(ptr + 42, true);
    const name = utf8.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    // local header to get real data offset
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? raw : await inflate(raw);
    if (data) out.set(name, data);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab[^>]*\/>/g, " ")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, " ");
}

async function extractDocx(buf: Uint8Array): Promise<string> {
  const zip = await zipEntries(buf);
  const doc = zip.get("word/document.xml");
  if (!doc) return "";
  return xmlText(utf8.decode(doc));
}

async function extractXlsx(buf: Uint8Array): Promise<string> {
  const zip = await zipEntries(buf);
  const shared: string[] = [];
  const sst = zip.get("xl/sharedStrings.xml");
  if (sst) {
    const xml = utf8.decode(sst);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]));
  }
  const lines: string[] = [];
  for (const [name, data] of zip) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = utf8.decode(data);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c[^>]*?(?:t="(\w+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?/g)) {
        const [, type, val] = c;
        if (val == null) {
          cells.push("");
          continue;
        }
        cells.push(type === "s" ? (shared[Number(val)] ?? "") : val);
      }
      if (cells.some(Boolean)) lines.push(cells.join(" | "));
    }
  }
  return lines.join("\n");
}

async function extractPdf(buf: Uint8Array): Promise<string> {
  const text: string[] = [];
  const src = latin1.decode(buf);
  // Inflate FlateDecode streams, then pull text-showing operators.
  const streamRe = /stream\r?\n?/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf("endstream", start);
    if (end < 0) continue;
    const chunk = buf.subarray(start, end);
    const inflated = await inflate(chunk);
    const body = inflated ? latin1.decode(inflated) : latin1.decode(chunk);
    for (const t of body.matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj|\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/g)) {
      const raw = t[0];
      const parts = [...raw.matchAll(/\((?:[^()\\]|\\.)*\)/g)].map((p) =>
        p[0].slice(1, -1).replace(/\\([()\\])/g, "$1"),
      );
      const joined = parts.join("");
      if (/[A-Za-z0-9]{2}/.test(joined)) text.push(joined);
    }
    streamRe.lastIndex = end;
  }
  return text.join(" ").replace(/\s+/g, " ").trim();
}

export async function extractText(filename: string, buf: Uint8Array): Promise<Extracted> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["txt", "md", "csv", "json", "html", "htm", "rtf"].includes(ext)) {
    return { text: utf8.decode(buf), ok: true };
  }
  if (ext === "docx") {
    const text = await extractDocx(buf);
    return { text, ok: text.trim().length > 40 };
  }
  if (ext === "xlsx" || ext === "xls") {
    const text = await extractXlsx(buf);
    return { text, ok: text.trim().length > 20 };
  }
  if (ext === "pdf") {
    const text = await extractPdf(buf);
    return { text, ok: text.trim().length > 60 };
  }
  // Unknown binary: try utf8 as a last resort
  const text = utf8.decode(buf).replace(/[^\P{C}\n\t]/gu, " ");
  return { text, ok: text.trim().length > 80 };
}

export async function fetchUrlText(url: string): Promise<Extracted> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { text: "", ok: false };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return { text, ok: text.length > 80 };
  } catch {
    return { text: "", ok: false };
  }
}

/* ------------------------------ ingest API ------------------------------ */

export interface IngestInput {
  tenantId: string;
  name: string;
  kind: KnowledgeDoc["kind"];
  text?: string; // already-extracted or pasted text
  file?: { filename: string; bytes: Uint8Array };
  url?: string;
}

export async function ingest(
  input: IngestInput,
): Promise<{ doc: KnowledgeDoc; chunks: number; extracted: boolean }> {
  const repo = await getRepo();
  const existing = await repo.listKnowledge(input.tenantId);
  const sameName = existing.filter((d) => d.name === input.name);
  const version = sameName.length ? Math.max(...sameName.map((d) => d.version)) + 1 : 1;

  let text = input.text ?? "";
  let extracted = Boolean(text);
  if (!text && input.file) {
    const res = await extractText(input.file.filename, input.file.bytes);
    text = res.text;
    extracted = res.ok;
  }
  if (!text && input.url) {
    const res = await fetchUrlText(input.url);
    text = res.text;
    extracted = res.ok;
  }

  const doc: KnowledgeDoc = {
    id: uid(),
    tenantId: input.tenantId,
    name: input.name,
    kind: input.kind,
    status: extracted ? "ingested" : "processing",
    version,
    updatedAt: new Date().toISOString(),
    chunkCount: 0,
    topics: [],
  };

  const chunks = extracted ? chunkText(text) : [];
  doc.chunkCount = chunks.length;
  doc.topics = [...new Set(chunks.flatMap((c) => c.topics))];

  // Nothing extracted: park what the async worker needs to retry it — the
  // original file bytes, or the URL for a page import. With nowhere to park it
  // the document is terminal, so it must not sit in `processing` forever.
  if (!extracted) {
    const parked = input.file
      ? await putRaw(input.tenantId, doc.id, input.file.bytes)
      : input.url
        ? await putRaw(input.tenantId, doc.id, new TextEncoder().encode(input.url))
        : false;
    if (!parked) doc.status = "failed";
  }

  await repo.addKnowledge(
    doc,
    chunks.map((c) => ({ docId: doc.id, tenantId: input.tenantId, content: c.content, topics: c.topics })),
  );
  await repo.addAudit({
    id: uid(),
    tenantId: input.tenantId,
    actor: "system",
    action: "knowledge.ingest",
    detail:
      doc.status === "ingested"
        ? `Ingested "${doc.name}" v${doc.version} (${doc.chunkCount} chunks)`
        : doc.status === "failed"
          ? `Ingested "${doc.name}" v${doc.version} — no text extracted and the upload could not be queued for retry`
          : `Ingested "${doc.name}" v${doc.version} — queued for async extraction (OCR worker)`,
    sources: [doc.name],
    createdAt: new Date().toISOString(),
  });

  return { doc, chunks: doc.chunkCount, extracted };
}

export const KNOWLEDGE_TOPICS = TOPIC_RULES.map((t) => t.topic);
