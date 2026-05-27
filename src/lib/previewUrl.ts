/** Client-side preview URL helpers (mirrors api/_lib/preview-url.ts). */

export function isVideoMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) || url.includes("/video");
}

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
