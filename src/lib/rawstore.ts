// Raw upload store — the R2 `FILES` binding.
//
// When a document's first extraction pass fails, the original bytes (or, for a
// URL import, the URL itself) are parked here so the async OCR worker can
// retry it later. The key is derived from the tenant + doc id, so no extra
// column is needed to find the object again.
//
// No binding available (plain `next dev`, tests, the demo store) → putRaw
// returns false and the caller marks the document `failed` instead of leaving
// it stuck in `processing`.

export const RAW_PREFIX = "raw/";

/** Minimal R2 bucket surface — the Worker only needs these three calls. */
interface R2Bucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: {
    httpMetadata?: { contentType?: string };
  }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<unknown>;
}

export function rawKey(tenantId: string, docId: string): string {
  return `${RAW_PREFIX}${tenantId}/${docId}`;
}

/** Reads the FILES binding. Mirrors getD1Binding() in repo-d1.ts. */
async function filesBinding(): Promise<R2Bucket | null> {
  const read = (ctx: unknown): R2Bucket | null => {
    const env = (ctx as { env?: Record<string, unknown> } | undefined)?.env;
    const files = env?.FILES;
    return files ? (files as R2Bucket) : null;
  };
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare/cloudflare-context");
    return read(getCloudflareContext());
  } catch {
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare/cloudflare-context");
      return read(await getCloudflareContext({ async: true }));
    } catch {
      return null;
    }
  }
}

/** Parks raw bytes under the derived key. False when R2 is unavailable. */
export async function putRaw(
  tenantId: string,
  docId: string,
  bytes: Uint8Array,
  contentType?: string,
): Promise<boolean> {
  try {
    const bucket = await filesBinding();
    if (!bucket) return false;
    await bucket.put(rawKey(tenantId, docId), bytes, {
      httpMetadata: contentType ? { contentType } : undefined,
    });
    return true;
  } catch (err) {
    console.error("rawstore.put failed", err);
    return false;
  }
}

/** Reads the parked upload back, or null when it is not there. */
export async function getRaw(tenantId: string, docId: string): Promise<Uint8Array | null> {
  try {
    const bucket = await filesBinding();
    if (!bucket) return null;
    const obj = await bucket.get(rawKey(tenantId, docId));
    if (!obj) return null;
    return new Uint8Array(await obj.arrayBuffer());
  } catch (err) {
    console.error("rawstore.get failed", err);
    return null;
  }
}

/** Drops the parked upload once a document is terminal (ingested/failed). */
export async function deleteRaw(tenantId: string, docId: string): Promise<void> {
  try {
    const bucket = await filesBinding();
    if (bucket) await bucket.delete(rawKey(tenantId, docId));
  } catch (err) {
    console.error("rawstore.delete failed", err);
  }
}
