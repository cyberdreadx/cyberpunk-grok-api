/**
 * /api/download — Proxy for downloading media that has CORS restrictions.
 * Fetches the file server-side and returns it with Content-Disposition: attachment.
 *
 * Usage: GET /api/download?url=https://vidgen.x.ai/...&filename=video.mp4
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

// Allow up to 60s for large video downloads
export const config = { maxDuration: 60 };

// Exact-match or subdomain-match only — no prefix matching
const ALLOWED_DOMAINS = [
  "vidgen.x.ai", "api.x.ai", "cdn.x.ai",
  "r2.cloudflarestorage.com",
  "vercel-storage.com",
  "runpod.io",
  "gltch.app", "cloud.gltch.app",
];

// R2 public bucket hostnames start with "pub-" and end with ".r2.dev"
function isAllowedHost(hostname: string): boolean {
  for (const d of ALLOWED_DOMAINS) {
    if (hostname === d || hostname.endsWith(`.${d}`)) return true;
  }
  if (/^pub-[a-z0-9]+\.r2\.dev$/.test(hostname)) return true;
  return false;
}

// Block requests to private/internal IP ranges
function isPrivateIP(hostname: string): boolean {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc|fd|fe80|localhost)/i.test(hostname);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const url = req.query.url as string;
    const rawFilename = (req.query.filename as string) || "download";
    const filename = rawFilename
      .replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, "_")
      .replace(/\.{2,}/g, ".")
      .slice(0, 200);

    if (!url) return res.status(400).json({ error: "Missing url parameter" });

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    if (parsedUrl.protocol !== "https:") {
      return res.status(403).json({ error: "Only HTTPS URLs allowed" });
    }

    if (isPrivateIP(parsedUrl.hostname)) {
      return res.status(403).json({ error: "Domain not allowed" });
    }

    if (!isAllowedHost(parsedUrl.hostname)) {
      return res.status(403).json({ error: "Domain not allowed" });
    }

    // Fetch the file server-side (no CORS issues)
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    }

    const upstreamType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const contentLength = upstream.headers.get("content-length");
    const inline = req.query.inline === "1" || req.query.inline === "true";

    // Never let this proxy serve active content from our own origin. The host
    // allowlist accepts ANY pub-*.r2.dev bucket (anyone can create one), and
    // Netlify rewrites /api/* to this server, so echoing an upstream
    // "text/html" or "image/svg+xml" with inline disposition would execute
    // attacker script same-origin with the SPA and expose the stored JWT.
    const SAFE_MEDIA_TYPES = new Set([
      "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif",
      "video/mp4", "video/webm", "video/quicktime",
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg",
      "application/pdf",
    ]);
    const isSafeMedia = SAFE_MEDIA_TYPES.has(upstreamType);
    const contentType = isSafeMedia ? upstreamType : "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Anything not on the media allowlist is force-downloaded, never rendered.
    if (inline && isSafeMedia) {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    } else {
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    }
    if (contentLength) res.setHeader("Content-Length", contentLength);
    const isImmutableCdn = /\.(public\.blob\.vercel-storage\.com|r2\.dev|gltch\.app)/i.test(parsedUrl.hostname);
    res.setHeader("Cache-Control", isImmutableCdn ? "public, max-age=86400, stale-while-revalidate=604800" : "public, max-age=3600");

    if (upstream.body) {
      // Stream through — avoid buffering multi-MB images/videos in memory.
      // upstream.body is a WHATWG ReadableStream. On the self-hosted Express
      // server, res.send() can't stream it: Express falls through to res.json()
      // and serializes the stream object to a near-empty body, which reached
      // users as 1–2KB "videos" that won't play. Convert to a Node stream and
      // pipe to the response — works on both Express and Vercel's Node runtime.
      const { Readable } = await import("node:stream");
      const nodeStream = Readable.fromWeb(upstream.body as any);
      res.status(200);
      nodeStream.on("error", (streamErr: any) => {
        console.error("[download] stream error:", streamErr?.message);
        if (!res.headersSent) res.status(502).json({ error: "Download stream failed" });
        else res.destroy(streamErr);
      });
      nodeStream.pipe(res);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buffer);
  } catch (err: any) {
    console.error("[download]", err.message);
    return res.status(500).json({ error: "Download failed" });
  }
}
