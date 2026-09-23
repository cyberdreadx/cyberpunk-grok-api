/**
 * Who still points at a stored file, and which files belong to a user's library.
 *
 * Deleting media is not one decision, it is two: does anything still reference
 * this object, and is this object even mine to delete? Until 2026-09-23 only
 * api/library-purge.ts asked either question. The other deletion paths — a share
 * being revoked, a feed post deleted, a story expiring — handed whatever URL
 * their row happened to hold straight to the storage layer.
 *
 * That matters because those rows do not hold a private copy. Posting or sharing
 * a generation stores the generation's OWN url, so the file under
 * comfyui-output/<uid>/ is simultaneously the feed post, the share, and the
 * video sitting in that user's library. Revoking one share deleted all three:
 * 60 of 191 video downloads on 2026-09-23 returned 404, and feed posts were left
 * pointing at files that no longer existed.
 */

import { isR2Url, r2KeyFromUrl } from "./r2";
import { isVercelBlobUrl } from "./blob";
import { previewKeyForKey } from "./preview-url";
import { getDb } from "./db";

/**
 * Generation output — the user's library. These objects are only ever deleted by
 * the surfaces that own that decision: the library purge, account deletion, and
 * the admin per-user storage sweep. A feed, story or share teardown must leave
 * them alone even when nothing else references them, because the library itself
 * is referenced only from the owner's device and is invisible to any DB query.
 */
export const LIBRARY_PREFIXES = ["comfyui-output/", "gltch/", "seedance/"];

export function isLibraryKey(key: string): boolean {
  return LIBRARY_PREFIXES.some((p) => key.startsWith(p));
}

export function blobKeyFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}

/** Every storage key still named by a row in the database. */
export async function loadReferencedKeys(): Promise<{ r2: Set<string>; blob: Set<string> }> {
  const sql = getDb();
  const r2 = new Set<string>();
  const blob = new Set<string>();
  const addRef = (url: unknown) => {
    if (typeof url !== "string" || !url) return;
    if (isR2Url(url)) {
      const key = r2KeyFromUrl(url);
      if (!key) return;
      r2.add(key);
      if (!key.endsWith("-preview.webp")) r2.add(previewKeyForKey(key));
    } else if (isVercelBlobUrl(url)) {
      const key = blobKeyFromUrl(url);
      if (key) blob.add(key);
    }
  };
  for (const r of await sql`SELECT image_url, preview_image_url FROM feed_posts`) {
    addRef(r.image_url);
    addRef(r.preview_image_url);
  }
  for (const r of await sql`SELECT media_url, preview_url FROM stories`) {
    addRef(r.media_url);
    addRef(r.preview_url);
  }
  for (const r of await sql`SELECT avatar_url FROM profiles WHERE avatar_url IS NOT NULL`) addRef(r.avatar_url);
  for (const r of await sql`SELECT portrait_url FROM characters WHERE portrait_url IS NOT NULL`) addRef(r.portrait_url);
  for (const r of await sql`SELECT DISTINCT actor_avatar_url FROM notifications WHERE actor_avatar_url IS NOT NULL`) addRef(r.actor_avatar_url);
  for (const r of await sql`SELECT DISTINCT media_url FROM chat_messages WHERE media_url IS NOT NULL`.catch(() => [] as any[])) addRef(r.media_url);
  return { r2, blob };
}
