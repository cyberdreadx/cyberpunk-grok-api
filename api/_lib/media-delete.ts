/**
 * Unified media deletion — routes each URL to Vercel Blob or R2 and also
 * removes the `-preview.webp` companion object each original may have.
 *
 * Callers should pass every stored URL they have (original + preview
 * columns); companion keys are additionally derived by naming convention
 * as a best-effort catch-all — deleting a key that doesn't exist is a
 * silent no-op on both backends.
 */
import { deleteBlobs, isVercelBlobUrl } from "./blob";
import { deleteR2Objects, isR2Url, r2KeyFromUrl } from "./r2";
import { previewKeyForKey } from "./preview-url";
import { loadReferencedKeys, isLibraryKey, blobKeyFromUrl } from "./media-refs";

export type MediaDeleteTally = {
  blob: { found: number; deleted: number; failed: number };
  r2: { found: number; deleted: number; failed: number };
  skipped: number;
};

function blobPreviewUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const key = u.pathname.replace(/^\/+/, "");
    if (!key || key.endsWith("-preview.webp")) return null;
    u.pathname = `/${previewKeyForKey(key)}`;
    return u.toString();
  } catch {
    return null;
  }
}

export interface MediaDeleteOptions {
  /**
   * Delete the caller's own library objects too (comfyui-output/, gltch/,
   * seedance/). Only the surfaces that OWN that decision pass this: the library
   * purge, account deletion, the admin storage sweep. A feed, story or share
   * teardown must never set it — the file is the user's library copy, and
   * nothing in the database can tell you whether their device still shows it.
   */
  allowLibraryMedia?: boolean;
}

/**
 * Best-effort delete of media URLs (and their preview companions) from Blob + R2.
 *
 * Guarded by default: anything another row still references is kept, and library
 * objects are kept unless the caller explicitly owns that decision. A failure to
 * load the references deletes NOTHING — deleting on the assumption that nothing
 * points at a file is the exact mistake this guard exists to prevent.
 */
export async function deleteMediaUrls(
  urls: Array<string | null | undefined>,
  opts: MediaDeleteOptions = {},
): Promise<MediaDeleteTally> {
  const blobUrls = new Set<string>();
  const r2Keys = new Set<string>();
  let skipped = 0;

  for (const url of urls) {
    if (!url || typeof url !== "string") continue;
    if (isVercelBlobUrl(url)) {
      blobUrls.add(url);
      const preview = blobPreviewUrl(url);
      if (preview) blobUrls.add(preview);
    } else if (isR2Url(url)) {
      const key = r2KeyFromUrl(url);
      if (!key) { skipped++; continue; }
      r2Keys.add(key);
      if (!key.endsWith("-preview.webp")) r2Keys.add(previewKeyForKey(key));
    } else {
      skipped++;
    }
  }

  // Keep anything still referenced, and anything that belongs to a library.
  if (r2Keys.size > 0 || blobUrls.size > 0) {
    try {
      const refs = await loadReferencedKeys();
      for (const key of [...r2Keys]) {
        if (refs.r2.has(key) || (!opts.allowLibraryMedia && isLibraryKey(key))) {
          r2Keys.delete(key);
          skipped++;
        }
      }
      for (const url of [...blobUrls]) {
        const key = blobKeyFromUrl(url);
        if (key && refs.blob.has(key)) {
          blobUrls.delete(url);
          skipped++;
        }
      }
    } catch (err: any) {
      console.warn("[media-delete] reference check failed, deleting nothing:", err?.message || err);
      skipped += r2Keys.size + blobUrls.size;
      r2Keys.clear();
      blobUrls.clear();
    }
  }

  const [blob, r2] = await Promise.all([
    deleteBlobs([...blobUrls]).catch((err) => {
      console.warn("[media-delete] blob:", err?.message || err);
      return { found: blobUrls.size, deleted: 0, failed: blobUrls.size };
    }),
    deleteR2Objects([...r2Keys]).catch((err) => {
      console.warn("[media-delete] r2:", err?.message || err);
      return { found: r2Keys.size, deleted: 0, failed: r2Keys.size };
    }),
  ]);

  return { blob, r2, skipped };
}
