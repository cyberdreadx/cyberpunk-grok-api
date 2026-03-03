/**
 * /api/download — Proxy for downloading media that has CORS restrictions.
 * Fetches the file server-side and returns it with Content-Disposition: attachment.
 *
 * Usage: GET /api/download?url=https://vidgen.x.ai/...&filename=video.mp4
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

// Allow up to 60s for large video downloads
export const config = { maxDuration: 60 };

// Allow proxying from trusted domains (xAI + our media CDNs)
const ALLOWED_HOSTS = [
  "vidgen.x.ai", "api.x.ai", "cdn.x.ai",
  "r2.cloudflarestorage.com", "pub-", // R2 public buckets
  "runpod.io",                        // RunPod serverless
  "gltch.app", "cloud.gltch.app",     // our own domains
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const url = req.query.url as string;
    // Sanitize filename: strip path separators, control chars, and double-quotes to prevent header injection
    const rawFilename = (req.query.filename as string) || "download";
    const filename = rawFilename
      .replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, "_") // strip dangerous chars
      .replace(/\.{2,}/g, ".") // collapse ".."
      .slice(0, 200); // cap length

    if (!url) return res.status(400).json({ error: "Missing url parameter" });

    // Validate the URL is from a trusted domain
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    if (!ALLOWED_HOSTS.some((h) =>
      parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`) || parsedUrl.hostname.startsWith(h)
    )) {
      return res.status(403).json({ error: "Domain not allowed" });
    }

    // Fetch the file server-side (no CORS issues)
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", "public, max-age=3600");

    // Stream the response
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buffer);
  } catch (err: any) {
    console.error("[download]", err.message);
    return res.status(500).json({ error: "Download failed" });
  }
}
