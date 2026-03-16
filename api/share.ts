import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST") {
    try {
      const { mediaBase64, mediaUrl, mediaType, prompt } = req.body || {};
      if (!mediaType || (!mediaBase64 && !mediaUrl)) {
        return res.status(400).json({ error: "mediaType and either mediaBase64 or mediaUrl required" });
      }

      let buffer: Buffer;

      if (mediaUrl) {
        // Server-side download (for videos / large files that exceed body limits)
        const urlObj = new URL(mediaUrl);
        if (!["https:"].includes(urlObj.protocol)) {
          return res.status(400).json({ error: "Only HTTPS URLs allowed" });
        }
        const dlResp = await fetch(mediaUrl, { signal: AbortSignal.timeout(25000) });
        if (!dlResp.ok) {
          return res.status(502).json({ error: `Failed to download media (${dlResp.status})` });
        }
        const arrayBuf = await dlResp.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      } else {
        const raw = mediaBase64.includes(",") ? mediaBase64.split(",")[1] : mediaBase64;
        buffer = Buffer.from(raw, "base64");
      }

      if (buffer.length > 50 * 1024 * 1024) {
        return res.status(413).json({ error: "File too large (max 50MB)" });
      }

      const shareId = crypto.randomBytes(6).toString("base64url").slice(0, 8);
      const ext = mediaType.includes("video") ? "mp4" : mediaType.includes("jpeg") ? "jpg" : "png";
      const contentType = mediaType.startsWith("video") ? "video/mp4" : mediaType.startsWith("image/") ? mediaType : "image/png";

      const { put } = await import("@vercel/blob");
      const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
      if (!token) {
        return res.status(503).json({ error: "Blob storage not configured" });
      }

      const mediaBlob = await put(`shares/${shareId}.${ext}`, buffer, {
        access: "public",
        contentType,
        addRandomSuffix: false,
        token,
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
        token,
      });

      const siteUrl = (process.env.SITE_URL || "https://grokrunner.gltch.app").replace(/\/$/, "");

      return res.status(200).json({
        shareId,
        shareUrl: `${siteUrl}/s/${shareId}`,
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

      const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
      const storeId = blobToken.split("_")[3] || "";
      const metaUrl = storeId
        ? `https://${storeId}.public.blob.vercel-storage.com/shares/${shareId}.json`
        : "";

      let meta: any = null;

      if (metaUrl) {
        const directResp = await fetch(metaUrl);
        if (directResp.ok) meta = await directResp.json();
      }

      if (!meta) {
        const { list } = await import("@vercel/blob");
        const { blobs } = await list({ prefix: `shares/${shareId}.json`, token: blobToken });
        if (blobs.length > 0) {
          const fallbackResp = await fetch(blobs[0].url);
          if (fallbackResp.ok) meta = await fallbackResp.json();
        }
      }

      if (!meta) {
        return res.status(404).json({ error: "Share not found" });
      }

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
