// Shared hybrid ranking used by every repository backend when embeddings
// are available: keyword overlap (the baseline everywhere) blended with
// cosine similarity of the query against stored chunk vectors.
//
// A chunk passes when it has a keyword hit OR a strong semantic match
// (cosine >= SEM_THRESHOLD), so vectors widen recall without letting vague
// near-misses crowd out exact term hits.
import { cosine } from "@/lib/embed";

export function retrievalTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9\u0900-\u097f]+/)
    .filter((t) => t.length > 1);
}

export interface VectorChunk {
  id: string;
  content: string;
  topics: string[];
  embedding?: number[] | null;
}

/** Same weighting the keyword backends use: +2 content term, +1 topic tag. */
export function keywordScore(qTokens: string[], content: string, topics: string[]): number {
  const text = new Set(retrievalTokens(content));
  let score = 0;
  for (const t of qTokens) {
    if (text.has(t)) score += 2;
    if (topics.some((topic) => topic.includes(t))) score += 1;
  }
  return score;
}

const SEM_THRESHOLD = 0.28;
const SEM_WEIGHT = 4;

export function rankHybrid<T extends VectorChunk>(
  qTokens: string[],
  queryVec: number[] | null,
  chunks: T[],
  limit: number,
): T[] {
  const scored = chunks.map((c) => {
    const kw = keywordScore(qTokens, c.content, c.topics);
    const sem = queryVec && c.embedding ? cosine(queryVec, c.embedding) : 0;
    return { c, kw, sem, score: kw + (queryVec ? Math.min(sem, 1) * SEM_WEIGHT : 0) };
  });
  const kept = queryVec
    ? scored.filter((x) => x.kw > 0 || x.sem >= SEM_THRESHOLD)
    : scored.filter((x) => x.kw > 0);
  return kept
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}
