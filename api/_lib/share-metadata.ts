/**
 * Load share link metadata from R2 (preferred) or legacy Vercel Blob.
 */
import { getPublicUrl, isR2MediaConfigured } from "./r2";

function blobToken(): string {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
}

export async function fetchShareMetadata(shareId: string): Promise<Record<string, unknown> | null> {
  if (isR2MediaConfigured()) {
    const metaUrl = getPublicUrl(`shares/${shareId}.json`);
    if (metaUrl) {
      try {
        const resp = await fetch(metaUrl, { signal: AbortSignal.timeout(8000) });
        if (resp.ok) return (await resp.json()) as Record<string, unknown>;
      } catch {
        /* fall through to blob */
      }
    }
  }

  const token = blobToken();
  if (!token) return null;

  const storeId = token.split("_")[3] || "";
  const directUrl = storeId
    ? `https://${storeId}.public.blob.vercel-storage.com/shares/${shareId}.json`
    : "";

  if (directUrl) {
    try {
      const resp = await fetch(directUrl, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) return (await resp.json()) as Record<string, unknown>;
    } catch {
      /* list fallback */
    }
  }

  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: `shares/${shareId}.json`, token });
    if (blobs.length > 0) {
      const resp = await fetch(blobs[0].url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) return (await resp.json()) as Record<string, unknown>;
    }
  } catch {
    /* not found */
  }

  return null;
}
