/** Derive companion preview object keys / public URLs (-preview.webp convention). */

export function previewKeyForKey(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot <= 0) return `${key}-preview.webp`;
  return `${key.slice(0, dot)}-preview.webp`;
}

export function isVideoMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) || url.includes("/video");
}

/** Guess the public preview URL for an original image URL (new uploads use -preview.webp). */
export function previewUrlForPublicUrl(url: string | null | undefined): string | undefined {
  if (!url || isVideoMediaUrl(url)) return undefined;
  if (url.includes("-preview.webp")) return url;
  try {
    const u = new URL(url);
    const nextPath = u.pathname.replace(/\.(png|jpe?g|webp|gif)$/i, "-preview.webp");
    if (nextPath === u.pathname) return undefined;
    u.pathname = nextPath;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Prefer stored preview column, then naming convention, optionally fall back to full. */
export function resolvePreviewUrl(
  storedPreview: string | null | undefined,
  fullUrl: string | null | undefined,
  opts?: { allowFullFallback?: boolean },
): string | undefined {
  if (storedPreview) return storedPreview;
  const derived = previewUrlForPublicUrl(fullUrl);
  if (derived) return derived;
  if (opts?.allowFullFallback && fullUrl && !isVideoMediaUrl(fullUrl)) return fullUrl;
  return undefined;
}
