/**
 * Vercel Blob deletion helpers.
 * Used to clean up uploaded media when posts/stories/avatars are deleted.
 */
import { del } from "@vercel/blob";

function getBlobToken(): string | null {
  return (
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.grokrun_READ_WRITE_TOKEN ||
    null
  );
}

/** Returns true if the URL appears to be hosted on Vercel Blob. */
export function isVercelBlobUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return /\.public\.blob\.vercel-storage\.com$/i.test(u.hostname) ||
      /\.blob\.vercel-storage\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Best-effort delete one or more Vercel Blob URLs.
 * Silently ignores non-blob URLs, missing tokens, and 404s so callers
 * never fail just because a file is already gone or hosted elsewhere.
 */
export async function deleteBlobs(urls: Array<string | null | undefined>): Promise<void> {
  const token = getBlobToken();
  if (!token) return;
  const targets = urls.filter((u): u is string => isVercelBlobUrl(u));
  if (targets.length === 0) return;
  await Promise.all(
    targets.map((url) =>
      del(url, { token }).catch((err) => {
        console.warn("[blob] delete failed for", url, err?.message || err);
      }),
    ),
  );
}
