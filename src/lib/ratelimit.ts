// Best-effort in-isolate rate limiting for the public endpoints.
// Buckets live in memory: that stops bursts from a single caller within an
// isolate. Workers isolates are ephemeral and replicated, so this is a brake,
// not a wall — the authorization layer and Meta's signature checks remain the
// real security boundary.
import { NextResponse } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED = 10_000;

export interface LimitResult {
  ok: boolean;
  retryAfterSec: number;
}

/** Fixed-window counter: `limit` hits per `windowMs` for `key`. */
export function rateLimit(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  if (buckets.size > MAX_TRACKED) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Cloudflare puts the caller address in cf-connecting-ip; fall back to the
 *  first x-forwarded-for entry for local/dev servers. */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "unknown";
}

/** Consume a slot for (name, ip) and get a 429 back when exhausted. */
export function limitOr429(
  name: string,
  req: Request,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const res = rateLimit(`${name}:${clientIp(req)}`, limit, windowMs);
  if (res.ok) return null;
  return NextResponse.json(
    { error: "too many requests" },
    { status: 429, headers: { "Retry-After": String(res.retryAfterSec) } },
  );
}
