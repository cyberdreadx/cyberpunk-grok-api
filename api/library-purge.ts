/**
 * Library trash purge — best-effort delete of any blob/R2 objects that
 * back the user's library entries when they empty their trash.
 *
 * Safety model: the library lives in IndexedDB, so we don't have a
 * server-side ownership table. We only delete objects whose storage key
 * encodes the calling user's id (the convention used by gltch.ts and
 * generate.ts). Anything else is silently skipped — never trust caller-
 * supplied URLs.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, verifyToken } from "./_lib/auth";
import { deleteBlobs, isVercelBlobUrl } from "./_lib/blob";
import { deleteR2Objects, isR2Url, r2KeyFromUrl } from "./_lib/r2";
import { previewKeyForKey } from "./_lib/preview-url";
import { recordPurge } from "./_lib/purgeLog";
import { getDb } from "./_lib/db";

/**
 * Keys minted before uploads were user-scoped (comfyui-output/<ts>-<rand>,
 * prompts/<ts>-<name>, …) carry no owner. For those we fall back to: delete
 * on request from any authenticated user UNLESS the object is referenced by
 * a server-side table (feed/stories/avatars/…). Worst case someone who knows
 * a URL deletes library media early — never exposes anything.
 */
const LEGACY_UNOWNED_PREFIXES = ["comfyui-output/", "prompts/", "uploads/"];

// Blob-side legacy transient uploads (prompts/<ts>-<name>-<suffix>): generation
// INPUTS only — never widen to output/library paths (root-level legacy blobs
// are users' library media, referenced only from their local IndexedDB).
const LEGACY_BLOB_TRANSIENT_PREFIXES = ["prompts/", "uploads/"];

function isLegacyUnownedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.split("/").length === 2 &&
    LEGACY_UNOWNED_PREFIXES.some((p) => lower.startsWith(p))
  );
}

function isLegacyTransientBlobKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.split("/").length === 2 &&
    LEGACY_BLOB_TRANSIENT_PREFIXES.some((p) => lower.startsWith(p))
  );
}

/** Every R2 key + Blob pathname referenced by a DB table (mirrors the orphan crons). */
async function loadReferencedKeys(): Promise<{ r2: Set<string>; blob: Set<string> }> {
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

function blobKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the given key is owned by `userId` based on the
 * naming conventions used elsewhere in this codebase:
 *   gltch/<userId>-<ts>.<ext>
 *   seedance/<userId>-<ts>.<ext>
 *   <userId>/...                  (per-user R2 prefix, future-proof)
 *   <folder>/<userId>/...         (presigned client uploads, media-upload.ts)
 */
function keyBelongsToUser(key: string, userId: string): boolean {
  if (!key || !userId) return false;
  const lower = key.toLowerCase();
  const uid = userId.toLowerCase();
  if (lower.startsWith(`gltch/${uid}-`)) return true;
  if (lower.startsWith(`seedance/${uid}-`)) return true;
  if (lower.startsWith(`${uid}/`)) return true;
  const segs = lower.split("/");
  if (segs.length >= 3 && segs[1] === uid) return true;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // pagehide beacons arrive as text/plain (no preflight) with the JWT in the
  // body — parse the string form and accept clientPayload like media-upload.
  let body: any = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const auth =
    getUserFromRequest(req) ||
    (typeof body.clientPayload === "string" ? verifyToken(body.clientPayload) : null);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { urls } = body as { urls?: unknown };
  if (!Array.isArray(urls)) return res.status(400).json({ error: "urls[] required" });

  // Cap to avoid abuse / oversized requests
  const candidates = urls
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice(0, 1000);

  const blobUrls: string[] = [];
  const r2Keys: string[] = [];
  const legacyKeys: string[] = [];
  const legacyBlobUrls: Array<{ url: string; key: string }> = [];
  let skipped = 0;

  for (const url of candidates) {
    if (isVercelBlobUrl(url)) {
      const key = blobKeyFromUrl(url);
      if (key && keyBelongsToUser(key, auth.userId)) blobUrls.push(url);
      else if (key && isLegacyTransientBlobKey(key)) legacyBlobUrls.push({ url, key });
      else skipped++;
    } else if (isR2Url(url)) {
      const key = r2KeyFromUrl(url);
      if (key && keyBelongsToUser(key, auth.userId)) {
        r2Keys.push(key);
        // Companion preview object shares the owner prefix — purge it too.
        if (!key.endsWith("-preview.webp")) r2Keys.push(previewKeyForKey(key));
      } else if (key && isLegacyUnownedKey(key)) {
        legacyKeys.push(key);
      } else skipped++;
    } else {
      skipped++;
    }
  }

  // Reference check, applied to EVERY candidate — not just the legacy ones.
  //
  // Owning a file is not the same as being free to delete it. Posting to the
  // feed stores the generation-output URL directly rather than copying the
  // object, so a user who posts a video and later empties their library trash
  // deletes the bytes out from under their own public post. It 404s for
  // everyone from then on, which is the "failed to load media" people are
  // hitting: every R2-hosted feed video lives under comfyui-output/<uid>/…,
  // and keyBelongsToUser() matches that, so ownership alone waved them
  // straight past the check that legacy keys already got.
  //
  // A DB failure here must fail CLOSED. Deleting on the assumption that
  // nothing references a file is exactly the mistake being fixed.
  if (r2Keys.length > 0 || blobUrls.length > 0 || legacyKeys.length > 0 || legacyBlobUrls.length > 0) {
    try {
      const refs = await loadReferencedKeys();

      const keepUnreferenced = (keys: string[]) => keys.filter((key) => {
        if (refs.r2.has(key)) { skipped++; return false; }
        return true;
      });
      const ownedR2 = keepUnreferenced(r2Keys);
      r2Keys.length = 0;
      r2Keys.push(...ownedR2);

      const ownedBlob = blobUrls.filter((url) => {
        const key = blobKeyFromUrl(url);
        if (key && refs.blob.has(key)) { skipped++; return false; }
        return true;
      });
      blobUrls.length = 0;
      blobUrls.push(...ownedBlob);

      for (const key of legacyKeys) {
        if (refs.r2.has(key)) { skipped++; continue; }
        r2Keys.push(key);
        const preview = previewKeyForKey(key);
        if (!key.endsWith("-preview.webp") && !refs.r2.has(preview)) r2Keys.push(preview);
      }
      for (const { url, key } of legacyBlobUrls) {
        if (refs.blob.has(key)) { skipped++; continue; }
        blobUrls.push(url);
      }
    } catch (err: any) {
      console.warn("[library-purge] ref check failed, deleting nothing:", err?.message || err);
      skipped += r2Keys.length + blobUrls.length + legacyKeys.length + legacyBlobUrls.length;
      r2Keys.length = 0;
      blobUrls.length = 0;
    }
  }

  // Best-effort — never fail the request, since the local trash is already empty.
  const [blobTally, r2Tally] = await Promise.all([
    deleteBlobs(blobUrls).catch((err) => {
      console.warn("[library-purge] blob:", err?.message || err);
      return { found: blobUrls.length, deleted: 0, failed: blobUrls.length };
    }),
    deleteR2Objects(r2Keys).catch((err) => {
      console.warn("[library-purge] r2:", err?.message || err);
      return { found: r2Keys.length, deleted: 0, failed: r2Keys.length };
    }),
  ]);

  await recordPurge({
    kind: "library-trash",
    actorUserId: auth.userId,
    actorEmail: auth.email,
    targetUserId: auth.userId,
    targetEmail: auth.email,
    blobsFound: blobTally.found,
    blobsDeleted: blobTally.deleted,
    r2Found: r2Tally.found,
    r2Deleted: r2Tally.deleted,
    errors: blobTally.failed + r2Tally.failed,
    notes: { skipped, candidates: candidates.length },
  });

  return res.status(200).json({
    deletedBlobs: blobTally.deleted,
    deletedR2: r2Tally.deleted,
    failedBlobs: blobTally.failed,
    failedR2: r2Tally.failed,
    skipped,
  });
}
