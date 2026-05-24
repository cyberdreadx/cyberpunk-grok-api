/**
 * Robust HEIC / iOS Live Photo handling.
 *
 * iOS Live Photos are a HEIC still + .MOV pair. Browsers only ever receive
 * the still (the .MOV is dropped by Photos before upload) UNLESS the user
 * explicitly "exports" the Live Photo as a video, in which case we get a
 * QuickTime .mov. We handle both cases here.
 *
 * Why this file exists:
 *  - Safari/iOS often delivers HEIC with an EMPTY `File.type` ("") instead
 *    of "image/heic", so MIME-only checks fail.
 *  - heic2any silently rejects some 10-bit / multi-image (Live Photo burst)
 *    HEICs. We try the modern `heic-to` first, then fall back to heic2any.
 *  - The .mov component needs a first-frame extraction.
 */

/** Quick check by MIME + extension (cheap, sync). */
export function isHeicLikeByName(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return (
    type === "image/heic" ||
    type === "image/heif" ||
    type === "image/heic-sequence" ||
    type === "image/heif-sequence" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif") ||
    name.endsWith(".hif")
  );
}

/** Live Photo motion component (QuickTime .mov). */
export function isLivePhotoMov(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return (
    type === "video/quicktime" ||
    type === "video/mov" ||
    name.endsWith(".mov")
  );
}

/**
 * Magic-byte sniff for HEIC. ISO BMFF: bytes 4-7 = "ftyp", bytes 8-11 = brand.
 * HEIC brands: heic, heix, hevc, hevx, mif1, msf1, heim, heis, hevm, hevs.
 */
async function sniffHeicMagic(file: File): Promise<boolean> {
  try {
    const head = await file.slice(0, 32).arrayBuffer();
    const view = new Uint8Array(head);
    if (view.length < 12) return false;
    const ftyp = String.fromCharCode(view[4], view[5], view[6], view[7]);
    if (ftyp !== "ftyp") return false;
    const brand = String.fromCharCode(view[8], view[9], view[10], view[11]);
    return /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|hevm|hevs)$/.test(brand);
  } catch {
    return false;
  }
}

/** Definitive HEIC check: cheap path first, then magic bytes. */
export async function isHeicFile(file: File): Promise<boolean> {
  if (isHeicLikeByName(file)) return true;
  // Empty MIME + no extension can still be a HEIC dragged off the camera roll.
  if (!file.type || file.type === "application/octet-stream") {
    return sniffHeicMagic(file);
  }
  return false;
}

async function convertHeicWithHeicTo(file: Blob, quality: number): Promise<Blob> {
  const { heicTo } = await import("heic-to");
  return await heicTo({ blob: file, type: "image/jpeg", quality });
}

async function convertHeicWithHeic2Any(file: Blob, quality: number): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality });
  return Array.isArray(out) ? out[0] : out;
}

/**
 * Convert a HEIC/HEIF blob to JPEG. Tries `heic-to` (handles 10-bit + Live
 * Photo bursts) first, falls back to `heic2any`.
 */
export async function heicToJpeg(file: File | Blob, quality = 0.9): Promise<Blob> {
  try {
    return await convertHeicWithHeicTo(file, quality);
  } catch (primaryErr) {
    try {
      return await convertHeicWithHeic2Any(file, quality);
    } catch (fallbackErr) {
      console.error("[heicConvert] both converters failed", { primaryErr, fallbackErr });
      throw new Error(
        "Could not decode HEIC image. On iPhone, set Settings → Camera → Formats → Most Compatible, or re-save as JPEG.",
      );
    }
  }
}

/** Extract the first visible frame of a .mov / video file as a JPEG blob. */
export async function videoFirstFrameToJpeg(file: File, quality = 0.9): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    (video as any).playsInline = true;
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        // Seek a hair past 0 so we get a real frame, not black.
        try {
          video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
        } catch { /* ignore */ }
      };
      video.addEventListener("loadeddata", onLoaded, { once: true });
      video.addEventListener("seeked", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("Video decode failed")), { once: true });
      // Safety timeout
      setTimeout(() => reject(new Error("Video frame extraction timed out")), 10_000);
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Frame encode failed"))),
        "image/jpeg",
        quality,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Normalize ANY user-picked file (HEIC, Live Photo MOV, JPEG, PNG, WebP) into
 * an image Blob that the rest of the app + canvas + Grok API can consume.
 *
 * - HEIC / HEIF → JPEG (via heic-to → heic2any fallback)
 * - Live Photo .mov → first-frame JPEG
 * - Already-an-image → passthrough
 * - Anything else → throws (caller shows a toast)
 */
export async function normalizeToImageBlob(file: File, quality = 0.9): Promise<Blob> {
  if (await isHeicFile(file)) {
    return heicToJpeg(file, quality);
  }
  if (isLivePhotoMov(file)) {
    return videoFirstFrameToJpeg(file, quality);
  }
  if ((file.type || "").startsWith("image/")) {
    return file;
  }
  // Last-ditch magic sniff for files with no type and unknown extension.
  if (!file.type) {
    if (await sniffHeicMagic(file)) return heicToJpeg(file, quality);
  }
  throw new Error("Unsupported file type. Use JPG, PNG, WebP, or HEIC.");
}

/** True if we should accept this file in drop/paste handlers. */
export async function isAcceptableImageLike(file: File): Promise<boolean> {
  if ((file.type || "").startsWith("image/")) return true;
  if (isLivePhotoMov(file)) return true;
  return isHeicFile(file);
}
