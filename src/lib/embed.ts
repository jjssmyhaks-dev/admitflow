// Optional embeddings for semantic retrieval.
//
//   LLM_API_KEY    required (same OpenAI-compatible key as the chat LLM)
//   LLM_BASE_URL   default https://api.openai.com/v1
//   EMBED_MODEL    default text-embedding-3-small; set to "off" to disable
//
// Every failure path returns null: callers then fall back to keyword search,
// so behaviour is unchanged when the feature is off or the provider has no
// /embeddings endpoint.
import { llmConfigured } from "@/lib/env";

const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
const BATCH = 64;
const TIMEOUT_MS = 10_000;

export function embeddingsConfigured(): boolean {
  return llmConfigured && process.env.EMBED_MODEL !== "off";
}

function baseUrl(): string {
  return (process.env.LLM_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function model(): string {
  const m = process.env.EMBED_MODEL;
  return m && m !== "off" ? m : DEFAULT_EMBED_MODEL;
}

/** Embeds texts in batches. Null on any error or shape mismatch. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!embeddingsConfigured() || texts.length === 0) return null;
  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH) {
      const input = texts.slice(i, i + BATCH).map((t) => t.slice(0, 4000));
      const res = await fetch(`${baseUrl()}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        },
        body: JSON.stringify({ model: model(), input }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
      const data = json.data;
      if (!Array.isArray(data) || data.length !== input.length) return null;
      const sorted = [...data]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((d) => d.embedding)
        .filter((v): v is number[] => Array.isArray(v) && v.length > 0);
      if (sorted.length !== input.length) return null;
      out.push(...sorted);
    }
    return out.length === texts.length ? out : null;
  } catch {
    return null;
  }
}

/** Single query embedding; null disables the semantic pass for this search. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const v = await embedTexts([text]);
  return v?.[0] ?? null;
}

export function cosine(
  a: number[] | null | undefined,
  b: number[] | null | undefined,
): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
