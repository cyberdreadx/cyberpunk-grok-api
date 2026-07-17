/**
 * /s/:id/og.png — Share preview image, served from the public link domain.
 *
 * Social crawlers fetch og:image; serving it from gltchrunner.com keeps the
 * whole preview on the unblocked domain instead of exposing the Blob/R2
 * storage hosts. Streams the stored share image through, whitelisted to our
 * own storage so this can't be used as an open proxy.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Readable } from "node:stream";
import { fetchShareMetadata } from "./_lib/share-metadata";
import { isVercelBlobUrl } from "./_lib/blob";
import { isR2Url } from "./_lib/r2";

export const config = { maxDuration: 10 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const shareId = String(req.query.id || "").slice(0, 64);
  if (!shareId) return res.status(400).send("Missing id");

  try {
    const meta = await fetchShareMetadata(shareId);
    const mediaUrl = String(meta?.mediaUrl || "");
    if (!meta || !mediaUrl || meta.mediaType === "video") {
      return res.redirect(302, "/og-image.png");
    }
    if (!isVercelBlobUrl(mediaUrl) && !isR2Url(mediaUrl)) {
      return res.redirect(302, "/og-image.png");
    }

    const upstream = await fetch(mediaUrl, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok || !upstream.body) {
      return res.redirect(302, "/og-image.png");
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/png");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    res.setHeader("Cache-Control", "public, max-age=86400");
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (err: any) {
    console.error("[share-image]", err?.message || err);
    return res.redirect(302, "/og-image.png");
  }
}
