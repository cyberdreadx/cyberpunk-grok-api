/**
 * Turn whatever a phone's file picker hands us into a sane, upload-ready JPEG.
 *
 * Written for Android Chrome, where uploads were failing before ever reaching
 * the server:
 *  - Files from Google Photos (cloud items), Drive or the Files app often arrive
 *    with an EMPTY or "application/octet-stream" type. MIME-only checks threw
 *    them out as "unsupported". We sniff the magic bytes instead.
 *  - Phone cameras shoot 50–200 MP. A 5 MB size check rejected most avatars,
 *    and decoding a full-size 12000px photo into a canvas can run a mid-range
 *    phone out of memory. We decode, then downscale to what we actually need.
 *  - createImageBitmap is missing or fails on some builds for some formats; we
 *    fall back to an <img> decode.
 *
 * Everything happens on the device. Nothing is uploaded here.
 */
import { heicToJpeg, isHeicFile, isLivePhotoMov, videoFirstFrameToJpeg } from "@/lib/heicConvert";

type Sniffed = "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp" | null;

async function sniffImage(file: Blob): Promise<Sniffed> {
  try {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
    if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
    const ascii = (s: number, e: number) => String.fromCharCode(...b.slice(s, e));
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "avif";
  } catch { /* unreadable — fall through */ }
  return null;
}

/** Is this something we can turn into an image? Type, extension or bytes. */
export async function isImageLike(file: File): Promise<boolean> {
  if ((file.type || "").startsWith("image/")) return true;
  if (isLivePhotoMov(file)) return true;
  if (await isHeicFile(file)) return true;
  return (await sniffImage(file)) !== null;
}

async function toDecodableBlob(file: File): Promise<Blob> {
  if (await isHeicFile(file)) return heicToJpeg(file, 0.9);
  if (isLivePhotoMov(file)) return videoFirstFrameToJpeg(file, 0.9);
  if ((file.type || "").startsWith("image/")) return file;
  const kind = await sniffImage(file);
  if (kind) return new Blob([file], { type: `image/${kind}` });
  throw new Error("That file isn't an image we can read. Try a JPG, PNG, WebP or HEIC.");
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Couldn't open this image. Try saving it as a JPG first.");
  }
}

/**
 * Normalize + downscale. Returns a JPEG no larger than maxDim on its longest
 * side (or the original when it's already small and a web format).
 */
export async function prepareImage(file: File, opts: { maxDim?: number; quality?: number } = {}): Promise<Blob> {
  const maxDim = opts.maxDim ?? 2048;
  const quality = opts.quality ?? 0.9;
  const blob = await toDecodableBlob(file);
  const d = await decode(blob);
  try {
    const small = d.width <= maxDim && d.height <= maxDim;
    const webSafe = /^image\/(jpeg|png|webp)$/.test(blob.type);
    if (small && webSafe && blob.size <= 4 * 1024 * 1024) return blob;

    const scale = Math.min(1, maxDim / Math.max(d.width, d.height));
    const w = Math.max(1, Math.round(d.width * scale));
    const h = Math.max(1, Math.round(d.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process this image on this device.");
    ctx.fillStyle = "#fff"; // transparent PNGs → white, not black, as JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(d.source, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process this image on this device."))), "image/jpeg", quality),
    );
  } finally {
    d.release();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("Couldn't read this image."));
    r.readAsDataURL(blob);
  });
}
