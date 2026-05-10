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
 * Returns `{ found, deleted, failed }` so callers can record audit trails.
 * Silently ignores non-blob URLs, missing tokens, and 404s so callers
 * never fail just because a file is already gone or hosted elsewhere.
 */
export async function deleteBlobs(
  urls: Array<string | null | undefined>,
): Promise<{ found: number; deleted: number; failed: number }> {
  const targets = urls.filter((u): u is string => isVercelBlobUrl(u));
  const found = targets.length;
  const token = getBlobToken();
  if (!token || found === 0) return { found, deleted: 0, failed: 0 };
  let deleted = 0;
  let failed = 0;
  await Promise.all(
    targets.map((url) =>
      del(url, { token })
        .then(() => { deleted++; })
        .catch((err) => {
          failed++;
          console.warn("[blob] delete failed for", url, err?.message || err);
        }),
    ),
  );
  return { found, deleted, failed };
}
