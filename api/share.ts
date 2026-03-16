/**
 * /api/share — Upload media and create/retrieve shareable links.
 *
 * POST: Upload base64 media → Vercel Blob, return { shareId, shareUrl, r2Url }
 * GET:  Retrieve share metadata by id → { r2Url, prompt, mediaType }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put, head } from "@vercel/blob";
import crypto from "crypto";

export const config = { maxDuration: 30 };

const ipHits = new Map<string, { count: number; resetAt: number }>();
function checkShareRate(ip: string, max = 15, windowMs = 300_000): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt < now) {
    ipHits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

function getClientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  if (Array.isArray(fwd)) return fwd[0];
  return req.socket?.remoteAddress || "unknown";
}

function generateShareId(): string {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
}

function extFromType(mediaType: string): string {
  if (mediaType.includes("video")) return "mp4";
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

function mimeFromType(mediaType: string): string {
  if (mediaType.startsWith("video")) return "video/mp4";
  if (mediaType.startsWith("image/")) return mediaType;
  return "image/png";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── POST: Upload and create share ──
  if (req.method === "POST") {
    try {
      const ip = getClientIp(req);
      if (!checkShareRate(ip)) {
        return res.status(429).json({ error: "Too many share requests. Try again later." });
      }

      const { mediaBase64, mediaType, prompt } = req.body || {};
      if (!mediaBase64 || !mediaType) {
        return res.status(400).json({ error: "mediaBase64 and mediaType required" });
      }

      const raw = mediaBase64.includes(",") ? mediaBase64.split(",")[1] : mediaBase64;
      const buffer = Buffer.from(raw, "base64");

      if (buffer.length > 50 * 1024 * 1024) {
        return res.status(413).json({ error: "File too large (max 50MB)" });
      }

      const shareId = generateShareId();
      const ext = extFromType(mediaType);
      const mediaPath = `shares/${shareId}.${ext}`;
      const metaPath = `shares/${shareId}.json`;

      const mediaBlob = await put(mediaPath, buffer, {
        access: "public",
        contentType: mimeFromType(mediaType),
        addRandomSuffix: false,
      });

      const metadata = JSON.stringify({
        mediaUrl: mediaBlob.url,
        mediaType: mediaType.startsWith("video") ? "video" : "image",
        prompt: prompt || "",
        createdAt: new Date().toISOString(),
      });

      await put(metaPath, metadata, {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
      });

      const host = req.headers.host || "grokrunner.gltch.app";
      const protocol = host.includes("localhost") ? "http" : "https";
      const shareUrl = `${protocol}://${host}/s/${shareId}`;

      return res.status(200).json({ shareId, shareUrl, r2Url: mediaBlob.url });
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

      const metaPath = `shares/${shareId}.json`;

      let metaUrl: string;
      try {
        const metaBlob = await head(metaPath);
        metaUrl = metaBlob.url;
      } catch {
        return res.status(404).json({ error: "Share not found" });
      }

      const metaResp = await fetch(metaUrl);
      if (!metaResp.ok) {
        return res.status(404).json({ error: "Share not found" });
      }

      const meta = await metaResp.json();

      return res.status(200).json({
        r2Url: meta.mediaUrl,
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
