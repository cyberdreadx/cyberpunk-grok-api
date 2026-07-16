/**
 * Server-side guarantee that a media URL has a companion preview image.
 *
 * Used for locked/paid posts and stories: the API must never hand the
 * full-res URL to non-payers, so a real preview object has to exist.
 * Only fetches from our own storage hosts (R2 / Vercel Blob) — callers
 * can pass arbitrary URLs without opening an SSRF hole.
 */
import { generateImagePreviewBuffer } from "./image-preview";
import { getPublicUrl, isR2Url, objectExists, r2KeyFromUrl, uploadToR2 } from "./r2";
import { isVercelBlobUrl } from "./blob";
import { previewKeyForKey } from "./preview-url";

const MAX_FETCH_BYTES = 100 * 1024 * 1024; // don't buffer >100MB videos
const FETCH_TIMEOUT_MS = 30_000;

function guessContentType(url: string): string {
  const m = url.toLowerCase().match(/\.([a-z0-9]+)(\?|#|$)/);
  switch (m?.[1]) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "mp4": case "m4v": return "video/mp4";
    case "webm": return "video/webm";
    case "mov": return "video/quicktime";
    default: return "application/octet-stream";
  }
}

/**
 * Returns a public preview URL for the media, generating + uploading one
 * (image resize or video first-frame, via image-preview.ts) if none exists.
 * Best-effort: returns null when the media can't be fetched or processed.
 */
export async function ensurePreviewForUrl(mediaUrl: string | null | undefined): Promise<string | null> {
  if (!mediaUrl || typeof mediaUrl !== "string") return null;
  const onR2 = isR2Url(mediaUrl);
  if (!onR2 && !isVercelBlobUrl(mediaUrl)) return null;

  const key = onR2 ? r2KeyFromUrl(mediaUrl) : null;
  if (key?.endsWith("-preview.webp")) return mediaUrl;

  // R2 originals may already have a companion by naming convention
  // (server-side uploads create one) — reuse it instead of regenerating.
  const previewKey = key
    ? previewKeyForKey(key)
    : `previews/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-preview.webp`;
  if (key && (await objectExists(previewKey))) {
    return getPublicUrl(previewKey) || null;
  }

  try {
    const resp = await fetch(mediaUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!resp.ok) return null;
    const declared = Number(resp.headers.get("content-length") || 0);
    if (declared > MAX_FETCH_BYTES) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_FETCH_BYTES) return null;

    const contentType = resp.headers.get("content-type") || guessContentType(mediaUrl);
    const preview = await generateImagePreviewBuffer(buf, contentType);
    if (!preview) return null;

    await uploadToR2(previewKey, preview, "image/webp");
    return getPublicUrl(previewKey) || null;
  } catch (err: any) {
    console.warn("[ensure-preview]", err?.message || err);
    return null;
  }
}
