/**
 * /api/share — Upload media and create/retrieve shareable links.
 *
 * POST: Upload base64 media → R2, return { shareId, shareUrl, r2Url }
 * GET:  Retrieve share metadata by id → { r2Url, prompt, mediaType }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { uploadToR2, getDownloadUrl, getPublicUrl, objectExists } from "./_lib/r2";
import { getR2Meta } from "./_lib/r2-meta";
import crypto from "crypto";

// Allow up to 30s for large uploads
export const config = { maxDuration: 30 };

/** Generate a short share ID (8 chars, URL-safe) */
function generateShareId(): string {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
}

/** Derive the file extension from a media type */
function extFromType(mediaType: string): string {
  if (mediaType.includes("video")) return "mp4";
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── POST: Upload and create share ──
  if (req.method === "POST") {
    try {
      const { mediaBase64, mediaType, prompt } = req.body || {};
      if (!mediaBase64 || !mediaType) {
        return res.status(400).json({ error: "mediaBase64 and mediaType required" });
      }

      // Strip data URI prefix if present
      const raw = mediaBase64.includes(",") ? mediaBase64.split(",")[1] : mediaBase64;
      const buffer = Buffer.from(raw, "base64");

      // Size limit: 50MB
      if (buffer.length > 50 * 1024 * 1024) {
        return res.status(413).json({ error: "File too large (max 50MB)" });
      }

      const shareId = generateShareId();
      const ext = extFromType(mediaType);
      const r2Key = `shares/${shareId}.${ext}`;

      // Upload media to R2
      const mimeType = mediaType.startsWith("video") ? "video/mp4"
        : mediaType.startsWith("image/") ? mediaType : "image/png";
      await uploadToR2(r2Key, buffer, mimeType);

      // Upload metadata JSON alongside media
      const metaKey = `shares/${shareId}.json`;
      const metadata = JSON.stringify({
        mediaKey: r2Key,
        mediaType: mediaType.startsWith("video") ? "video" : "image",
        prompt: prompt || "",
        createdAt: new Date().toISOString(),
      });
      await uploadToR2(metaKey, Buffer.from(metadata), "application/json");

      // Build the share URL
      const host = req.headers.host || "grokrunner.app";
      const protocol = host.includes("localhost") ? "http" : "https";
      const shareUrl = `${protocol}://${host}/s/${shareId}`;

      // Get the media URL (public or presigned)
      let r2Url = getPublicUrl(r2Key);
      if (!r2Url) r2Url = await getDownloadUrl(r2Key);

      return res.status(200).json({ shareId, shareUrl, r2Url });
    } catch (err: any) {
      console.error("[share] POST error:", err.message);
      return res.status(500).json({ error: "Failed to create share" });
    }
  }

  // ── GET: Retrieve share data ──
  if (req.method === "GET") {
    try {
      const shareId = req.query.id as string;
      if (!shareId || !/^[a-zA-Z0-9_-]{4,16}$/.test(shareId)) {
        return res.status(400).json({ error: "Invalid share ID" });
      }

      const metaKey = `shares/${shareId}.json`;
      const exists = await objectExists(metaKey);
      if (!exists) {
        return res.status(404).json({ error: "Share not found" });
      }

      // Download metadata
      const meta = await getR2Meta(metaKey);

      // Generate download URL for the media
      let r2Url = getPublicUrl(meta.mediaKey);
      if (!r2Url) r2Url = await getDownloadUrl(meta.mediaKey);

      return res.status(200).json({
        r2Url,
        mediaType: meta.mediaType,
        prompt: meta.prompt,
        createdAt: meta.createdAt,
      });
    } catch (err: any) {
      console.error("[share] GET error:", err.message);
      return res.status(500).json({ error: "Failed to retrieve share" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
