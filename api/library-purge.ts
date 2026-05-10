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
import { getUserFromRequest } from "./_lib/auth";
import { deleteBlobs, isVercelBlobUrl } from "./_lib/blob";
import { deleteR2Objects, isR2Url, r2KeyFromUrl } from "./_lib/r2";

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
 */
function keyBelongsToUser(key: string, userId: string): boolean {
  if (!key || !userId) return false;
  const lower = key.toLowerCase();
  const uid = userId.toLowerCase();
  if (lower.startsWith(`gltch/${uid}-`)) return true;
  if (lower.startsWith(`seedance/${uid}-`)) return true;
  if (lower.startsWith(`${uid}/`)) return true;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { urls } = (req.body || {}) as { urls?: unknown };
  if (!Array.isArray(urls)) return res.status(400).json({ error: "urls[] required" });

  // Cap to avoid abuse / oversized requests
  const candidates = urls
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice(0, 1000);

  const blobUrls: string[] = [];
  const r2Keys: string[] = [];
  let skipped = 0;

  for (const url of candidates) {
    if (isVercelBlobUrl(url)) {
      const key = blobKeyFromUrl(url);
      if (key && keyBelongsToUser(key, auth.userId)) blobUrls.push(url);
      else skipped++;
    } else if (isR2Url(url)) {
      const key = r2KeyFromUrl(url);
      if (key && keyBelongsToUser(key, auth.userId)) r2Keys.push(key);
      else skipped++;
    } else {
      skipped++;
    }
  }

  // Best-effort — never fail the request, since the local trash is already empty.
  await Promise.all([
    deleteBlobs(blobUrls).catch((err) => console.warn("[library-purge] blob:", err?.message || err)),
    deleteR2Objects(r2Keys).catch((err) => console.warn("[library-purge] r2:", err?.message || err)),
  ]);

  return res.status(200).json({
    deletedBlobs: blobUrls.length,
    deletedR2: r2Keys.length,
    skipped,
  });
}
