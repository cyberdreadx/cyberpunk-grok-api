/**
 * Client-side downscale for feed/story preview uploads (~480px).
 *
 * Asking canvas.toBlob() for "image/webp" is a request, not a guarantee: a
 * browser that cannot encode WebP silently returns PNG instead, and the blob
 * still resolves. That is how PNG files ended up in R2 under .webp names being
 * served as image/webp — browsers sniff the bytes, so they rendered fine and
 * nobody noticed the size. A 480px PNG is 230-360KB where the same frame in
 * WebP is 9-30KB, and seven of those on one screen was 2.0MB of a 2.27MB feed.
 *
 * So: try WebP, and if the browser hands back anything else, re-encode as JPEG.
 * JPEG is universally supported by toBlob and lands around 30-50KB at this
 * size. PNG is never an acceptable answer for a photographic thumbnail.
 *
 * The caller must read the returned blob's own `type` rather than assuming.
 */

export async function generatePreviewBlob(blob: Blob, maxDim = 480): Promise<Blob | null> {
  if (!blob.type.startsWith("image/")) return null;
  if (typeof document === "undefined") return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const encode = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), type, q));

  const webp = await encode("image/webp", 0.82);
  if (webp && webp.type === "image/webp") return webp;

  // The browser ignored the request — almost always meaning no canvas WebP
  // encoder. Anything it produced instead is PNG, which is the worst possible
  // choice here, so encode JPEG explicitly.
  const jpeg = await encode("image/jpeg", 0.82);
  if (jpeg && jpeg.type === "image/jpeg") return jpeg;

  // Both refused. Returning the PNG is still better than no preview at all,
  // and the upload path now labels it by its real type so it is at least
  // served correctly and can be re-encoded server-side later.
  return webp ?? jpeg ?? null;
}
