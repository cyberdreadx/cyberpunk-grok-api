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
    video.preload = "auto";
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
