/**
 * Video poster cache.
 *
 * Extracts a single frame (~0.1s) from a video URL and returns a data URL
 * suitable for use as an <img src> poster. Results are memoized in-memory
 * for the session and persisted to sessionStorage so re-mounts (e.g. while
 * scrolling a virtualised feed) are instant.
 *
 * Pure client-side — works for any same-origin or CORS-enabled video URL.
 * If extraction fails (CORS taint, network error, codec), resolves null and
 * the caller should fall back to its existing video element.
 */

const MEM = new Map<string, string | null>();
const STORAGE_PREFIX = "gltch-vposter:";
const MAX_DIM = 480; // keep posters small

function readSession(url: string): string | null | undefined {
  try {
    const v = sessionStorage.getItem(STORAGE_PREFIX + url);
    if (v === null) return undefined;
    return v === "" ? null : v;
  } catch { return undefined; }
}

function writeSession(url: string, dataUrl: string | null) {
  try { sessionStorage.setItem(STORAGE_PREFIX + url, dataUrl ?? ""); } catch {}
}

export function getCachedPoster(url: string): string | null | undefined {
  if (MEM.has(url)) return MEM.get(url);
  const fromStorage = readSession(url);
  if (fromStorage !== undefined) {
    MEM.set(url, fromStorage);
    return fromStorage;
  }
  return undefined;
}

export function extractPoster(url: string): Promise<string | null> {
  const cached = getCachedPoster(url);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    (video as any).playsInline = true;
    // "metadata" rather than "auto": we seek to ~0.1s and capture one frame, so
    // the browser only needs that range. "auto" pulls the whole file, and with
    // a screenful of video tiles extracting at once that saturates the
    // connection and every extraction hits the 8s timeout instead.
    video.preload = "metadata";
    video.src = url;

    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      MEM.set(url, result);
      writeSession(url, result);
      try { video.removeAttribute("src"); video.load(); } catch {}
      resolve(result);
    };

    const onLoaded = () => {
      try {
        // Seek a hair past 0 to dodge black first frames.
        const t = Math.min(0.1, (video.duration || 1) * 0.05);
        if (Number.isFinite(t) && t > 0) video.currentTime = t;
        else captureFrame();
      } catch { finish(null); }
    };

    const captureFrame = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return finish(null);
        const scale = Math.min(1, MAX_DIM / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, cw, ch);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        finish(dataUrl && dataUrl.length > 32 ? dataUrl : null);
      } catch {
        // Most likely a CORS taint — silently fall back.
        finish(null);
      }
    };

    video.addEventListener("loadeddata", onLoaded, { once: true });
    video.addEventListener("seeked", captureFrame, { once: true });
    video.addEventListener("error", () => finish(null), { once: true });
    // Hard timeout so we never hang the skeleton forever.
    setTimeout(() => finish(null), 8000);
  });
}


/**
 * The still frame the SERVER already made for a video we host.
 *
 * Every upload gets a companion thumbnail beside it (`<name>-preview.webp`,
 * ffmpeg in api/_lib/image-preview.ts). The library never used them: each tile
 * mounted a <video preload="metadata"> and hoped the browser painted frame 0.1,
 * which streams video headers for every tile on the page and still leaves a
 * black rectangle on iOS Safari.
 *
 * Prefer this over extractPoster() where the media is ours — it is one ~20KB
 * fetch instead of decoding a video frame in a canvas, and it cannot be tainted
 * by CORS. extractPoster stays for anything hosted elsewhere.
 *
 * Returns undefined for blob:/data: URLs, which are local and decode instantly,
 * and for hosts that are not ours, where the convention does not apply.
 */
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function videoPosterUrl(url: string | null | undefined): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  if (url.startsWith("blob:") || url.startsWith("data:")) return undefined;
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  const ours =
    u.hostname.endsWith(BLOB_HOST_SUFFIX) ||
    /\.r2\.dev$/.test(u.hostname) ||
    /(^|\.)gltch\.app$/.test(u.hostname);
  if (!ours) return undefined;
  u.search = "";
  if (u.pathname.endsWith("-preview.webp")) return u.toString();
  const dot = u.pathname.lastIndexOf(".");
  if (dot <= 0) return undefined;
  u.pathname = `${u.pathname.slice(0, dot)}-preview.webp`;
  return u.toString();
}
