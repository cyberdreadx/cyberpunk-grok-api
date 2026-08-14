/**
 * /api/media-upload — Presigned direct-to-R2 uploads (avoids Vercel Blob egress).
 *
 * POST { action: "presign", folder, filename, contentType }
 *   -> { uploadUrl, publicUrl, key, storage: "r2" }
 *
 * Requires R2_* env vars. Client PUTs the file bytes to uploadUrl, then uses publicUrl.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import {
  createPresignedMediaUpload,
  isR2MediaConfigured,
  uploadPublicMedia,
  uniqueMediaKey,
} from "./_lib/media-storage";

const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!isR2MediaConfigured()) {
    return res.status(503).json({
      error: "R2 media storage not configured",
      code: "R2_NOT_CONFIGURED",
      hint: "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_PUBLIC_BUCKET_URL (or R2_PUBLIC_DOMAIN) on Vercel.",
    });
  }

  const body = req.body || {};
  const action = body.action || "presign";

  if (action !== "presign" && action !== "proxy") {
    return res.status(400).json({ error: "Unknown action" });
  }

  const jwt =
    (typeof body.clientPayload === "string" && verifyToken(body.clientPayload)) ||
    verifyToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!jwt) return res.status(401).json({ error: "Unauthorized" });

  const folder = String(body.folder || body.pathname || "uploads").slice(0, 80);
  const filename = String(body.filename || "file.bin").slice(0, 120);
  const contentType = String(body.contentType || "application/octet-stream").toLowerCase();

  if (!ALLOWED_TYPES.has(contentType)) {
    return res.status(400).json({ error: `Content type not allowed: ${contentType}` });
  }

  // Server-side upload for when the browser can't PUT to R2 itself.
  //
  // The presigned PUT is cross-origin, so it needs a CORS policy on the
  // bucket. Without one the preflight is rejected outright and every upload
  // in the app dies — which is exactly what happened to feed posts and
  // stories. Relaying the bytes through here costs a hop and some memory, but
  // it has no CORS surface at all, so it works regardless of bucket config.
  if (action === "proxy") {
    const b64 = String(body.dataBase64 || "");
    if (!b64) return res.status(400).json({ error: "dataBase64 required" });
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return res.status(400).json({ error: "dataBase64 is not valid base64" });
    }
    // Express caps JSON at 50mb; base64 inflates ~33%, so this is the real
    // ceiling for a relayed upload. Direct-to-R2 has no such limit.
    if (!buf.length) return res.status(400).json({ error: "Empty upload" });
    if (buf.length > 36 * 1024 * 1024) {
      return res.status(413).json({ error: "File too large for relay upload (36MB max)" });
    }
    try {
      const key = uniqueMediaKey(`${folder}/${jwt.userId}`, filename);
      const out = await uploadPublicMedia(buf, key, contentType);
      return res.status(200).json({ ...out, via: "proxy" });
    } catch (err: any) {
      console.error("[media-upload proxy]", err?.message);
      return res.status(500).json({ error: err?.message || "Upload failed" });
    }
  }

  try {
    // Scope the object key under the uploader's user id so ownership is
    // provable from the key alone (library-purge / delete-account rely on it).
    const result = await createPresignedMediaUpload(`${folder}/${jwt.userId}`, filename, contentType);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[media-upload]", err?.message);
    return res.status(500).json({ error: err?.message || "Presign failed" });
  }
}
