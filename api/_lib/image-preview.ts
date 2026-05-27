/**
 * Server-side image preview generation (Sharp) for uploads that hit the API directly.
 */

const PREVIEW_MAX = 480;

export async function generateImagePreviewBuffer(
  buffer: Buffer,
  contentType: string,
): Promise<Buffer | null> {
  if (!contentType.startsWith("image/")) return null;
  if (contentType.includes("gif")) return null;

  try {
    const sharp = (await import("sharp")).default;
    return sharp(buffer)
      .rotate()
      .resize(PREVIEW_MAX, PREVIEW_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err: any) {
    console.warn("[image-preview] generate failed:", err?.message || err);
    return null;
  }
}
