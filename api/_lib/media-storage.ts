/**
 * Unified public media storage — prefers Cloudflare R2 (free egress) over Vercel Blob.
 */
import { put } from "@vercel/blob";
import { getPresignedUploadUrl, getPublicUrl, isR2MediaConfigured, uploadToR2 } from "./r2";
import { generateImagePreviewBuffer } from "./image-preview";
import { previewKeyForKey } from "./preview-url";

export type MediaUploadResult = {
  url: string;
  previewUrl?: string;
  storage: MediaStorageBackend;
  key: string;
};

function blobToken(): string {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
}

export type MediaStorageBackend = "r2" | "blob";

export { isR2MediaConfigured };

/** Sanitize a user-supplied path segment. */
export function sanitizeMediaKey(pathname: string): string {
  const cleaned = pathname
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9/_.-]/g, "_")
    .slice(0, 180);
  return cleaned || "upload.bin";
}

/** Build a unique object key under an optional prefix folder. */
export function uniqueMediaKey(folder: string, filename: string): string {
  const base = sanitizeMediaKey(filename);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const folderClean = sanitizeMediaKey(folder).replace(/\/$/, "");
  const parts = base.split("/");
  const leaf = parts.pop() || "file.bin";
  const dot = leaf.lastIndexOf(".");
  const stamped =
    dot > 0
      ? `${leaf.slice(0, dot)}-${stamp}${leaf.slice(dot)}`
      : `${leaf}-${stamp}`;
  return folderClean ? `${folderClean}/${stamped}` : stamped;
}

function hasR2Credentials(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

/** Server-side upload — R2 when configured, else Vercel Blob. Generates WebP preview for images. */
export async function uploadPublicMedia(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<MediaUploadResult> {
  const safeKey = sanitizeMediaKey(key);
  let url: string;
  let storage: MediaStorageBackend;

  if (hasR2Credentials()) {
    if (!isR2MediaConfigured()) {
      throw new Error(
        "R2 credentials are set but R2_PUBLIC_BUCKET_URL is missing. " +
        "Add the bucket's Public Development URL (https://pub-xxxxx.r2.dev) in Vercel — no custom CDN domain required.",
      );
    }
    await uploadToR2(safeKey, buffer, contentType);
    url = getPublicUrl(safeKey);
    if (!url) throw new Error("R2 public URL not configured");
    storage = "r2";
  } else {
    const token = blobToken();
    if (!token) throw new Error("No media storage configured (R2 or BLOB_READ_WRITE_TOKEN)");

    const blob = await put(safeKey, buffer, {
      access: "public",
      contentType,
      token,
      cacheControlMaxAge: 31536000,
    });
    url = blob.url;
    storage = "blob";
  }

  let previewUrl: string | undefined;
  const previewBuf = await generateImagePreviewBuffer(buffer, contentType);
  if (previewBuf) {
    const previewKey = previewKeyForKey(safeKey);
    if (hasR2Credentials() && isR2MediaConfigured()) {
      await uploadToR2(previewKey, previewBuf, "image/webp");
      previewUrl = getPublicUrl(previewKey) || undefined;
    } else {
      const token = blobToken();
      if (token) {
        const previewBlob = await put(previewKey, previewBuf, {
          access: "public",
          contentType: "image/webp",
          token,
          cacheControlMaxAge: 31536000,
        });
        previewUrl = previewBlob.url;
      }
    }
  }

  return { url, previewUrl, storage, key: safeKey };
}

/** Client direct-to-R2 presigned upload metadata. */
export async function createPresignedMediaUpload(
  folder: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; publicUrl: string; key: string; storage: MediaStorageBackend }> {
  if (!isR2MediaConfigured()) {
    throw new Error("R2_NOT_CONFIGURED");
  }
  const key = uniqueMediaKey(folder, filename);
  const uploadUrl = await getPresignedUploadUrl(key, contentType);
  const publicUrl = getPublicUrl(key);
  if (!publicUrl) throw new Error("R2 public URL not configured");
  return { uploadUrl, publicUrl, key, storage: "r2" };
}
