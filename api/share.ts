import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST") {
    try {
      const { mediaBase64, mediaType, prompt } = req.body || {};
      if (!mediaBase64 || !mediaType) {
        return res.status(400).json({ error: "mediaBase64 and mediaType required" });
      }

      const raw = mediaBase64.includes(",") ? mediaBase64.split(",")[1] : mediaBase64;
      const buffer = Buffer.from(raw, "base64");

      if (buffer.length > 50 * 1024 * 1024) {
        return res.status(413).json({ error: "File too large (max 50MB)" });
      }

      const shareId = crypto.randomBytes(6).toString("base64url").slice(0, 8);
      const ext = mediaType.includes("video") ? "mp4" : mediaType.includes("jpeg") ? "jpg" : "png";
      const contentType = mediaType.startsWith("video") ? "video/mp4" : mediaType.startsWith("image/") ? mediaType : "image/png";

      const { put } = await import("@vercel/blob");

      const mediaBlob = await put(`shares/${shareId}.${ext}`, buffer, {
        access: "public",
        contentType,
        addRandomSuffix: false,
      });

      const metadata = JSON.stringify({
        mediaUrl: mediaBlob.url,
        mediaType: mediaType.startsWith("video") ? "video" : "image",
        prompt: prompt || "",
        createdAt: new Date().toISOString(),
      });

      await put(`shares/${shareId}.json`, metadata, {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
      });

      const host = req.headers.host || "grokrunner.gltch.app";
      const protocol = host.includes("localhost") ? "http" : "https";

      return res.status(200).json({
        shareId,
        shareUrl: `${protocol}://${host}/s/${shareId}`,
        r2Url: mediaBlob.url,
      });
    } catch (err: any) {
      console.error("[share] POST error:", err.message);
      return res.status(500).json({ error: "Failed to create share" });
    }
  }

  if (req.method === "GET") {
    try {
      const shareId = req.query.id as string;
      if (!shareId || !/^[a-zA-Z0-9_-]{4,16}$/.test(shareId)) {
        return res.status(400).json({ error: "Invalid share ID" });
      }

      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: `shares/${shareId}.json` });

      if (blobs.length === 0) {
        return res.status(404).json({ error: "Share not found" });
      }

      const metaResp = await fetch(blobs[0].url);
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
