/**
 * Media URL fallback chain.
 *
 * Feed media may live on different CDN hosts over the lifetime of a post:
 *   - Vercel Blob (`<storeId>.public.blob.vercel-storage.com`)
 *   - Cloudflare R2 public buckets (`pub-xxxxx.r2.dev`)
 *   - Custom domains (`cdn.gltch.app`, etc.)
 *
 * Old posts can reference hosts that have rotated, been renamed, or
 * temporarily 404. `mediaCandidates(url)` returns a prioritised list of URLs
 * to try in order; components walk the list in their `onError` handler. The
 * last candidate is always the server-side proxy (`/api/download?inline=1`)
 * which can stream from any allow-listed host even when the browser would
 * otherwise CORS-block or 404 on a stale CDN URL.
 */

import { apiUrl } from "@/lib/api";

// Current canonical Vercel Blob store. Update this if the store rotates;
// the fallback chain will continue to work because we always include the
// server proxy as the last hop.
const CANONICAL_BLOB_STORE = "b1ynbqvcamyje8yr";
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

function safeParse(url: string): URL | null {
  try { return new URL(url); } catch { return null; }
}

/** Rewrite a Vercel Blob URL to use the current canonical store id. */
function rewriteBlobStore(url: string): string | null {
  const u = safeParse(url);
  if (!u) return null;
  if (!u.hostname.endsWith(BLOB_HOST_SUFFIX)) return null;
  const currentStore = u.hostname.slice(0, -BLOB_HOST_SUFFIX.length);
  if (currentStore === CANONICAL_BLOB_STORE) return null;
  u.hostname = `${CANONICAL_BLOB_STORE}${BLOB_HOST_SUFFIX}`;
  return u.toString();
}

/** Build the inline-streaming proxy URL for any allow-listed source. */
export function proxiedMediaUrl(url: string): string {
  return `${apiUrl("/download")}?inline=1&url=${encodeURIComponent(url)}`;
}

/**
 * Returns an ordered list of URLs to attempt for a given source. Always
 * includes the original URL first and the inline proxy last, with any
 * known host-rewrites in between. Callers should advance through the list
 * each time `<img onError>` / `<video onError>` fires until one resolves.
 */
export function mediaCandidates(url: string): string[] {
  if (!url) return [];
  const out: string[] = [url];
  const blobRewritten = rewriteBlobStore(url);
  if (blobRewritten && !out.includes(blobRewritten)) out.push(blobRewritten);

  // Final hop: ask the server to fetch + stream the original URL inline.
  // Only adds if the URL is plausibly remote (skip data:/blob:).
  if (/^https?:\/\//i.test(url)) {
    const proxied = proxiedMediaUrl(url);
    if (!out.includes(proxied)) out.push(proxied);
  }
  return out;
}
