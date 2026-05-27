/**
 * Client media uploads — direct to Cloudflare R2 when available, else Vercel Blob.
 * Generates and uploads a -preview.webp companion for images.
 */
import { upload } from "@vercel/blob/client";
import { apiFetch, apiUrl } from "@/lib/api";
import { generatePreviewBlob } from "@/lib/generatePreviewBlob";
import { previewUrlForPublicUrl } from "@/lib/previewUrl";

const R2_HOST_RE = /\.r2\.dev$|\.r2\.cloudflarestorage\.com$/i;

export type MediaUploadResult = {
  url: string;
  previewUrl?: string;
};

/** URLs that are already on durable public storage (not ephemeral xAI/RunPod links). */
export function isPermanentPublicMediaUrl(url: string): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.endsWith("blob.vercel-storage.com")) return true;
    if (R2_HOST_RE.test(h)) return true;
    const r2Domain = (import.meta.env.VITE_R2_PUBLIC_DOMAIN || "").toLowerCase();
    if (r2Domain && h === r2Domain) return true;
    return false;
  } catch {
    return false;
  }
}

function previewFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}-preview.webp`;
}

async function uploadOne(
  blob: Blob,
  folder: string,
  filename: string,
  contentType: string,
  authToken: string,
): Promise<string> {
  try {
    const presign = await apiFetch<{
      uploadUrl: string;
      publicUrl: string;
    }>("/media-upload", {
      method: "POST",
      body: {
        action: "presign",
        folder,
        filename,
        contentType,
        clientPayload: authToken,
      },
    });

    const putResp = await fetch(presign.uploadUrl, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": contentType },
    });
    if (!putResp.ok) throw new Error(`R2 upload failed (${putResp.status})`);
    return presign.publicUrl;
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (!msg.includes("R2") && !msg.includes("503") && !msg.includes("not configured")) {
      throw err;
    }
  }

  const ext =
    contentType === "image/png" ? "png"
    : contentType === "image/webp" ? "webp"
    : contentType.startsWith("video/") ? (contentType.split("/")[1] || "mp4")
    : "jpg";
  const safeName = `${folder}/${Date.now()}-${filename.replace(/[^\w.-]/g, "_") || "upload"}.${ext}`;
  const { url } = await upload(safeName, blob, {
    access: "public",
    handleUploadUrl: apiUrl("/blob-upload"),
    clientPayload: authToken,
  });
  return url;
}

/**
 * Upload a file/blob to public storage.
 * @param folder  e.g. "feed", "stories", "avatars"
 * @param filename  e.g. "post.jpg"
 */
export async function uploadPublicMedia(
  blob: Blob,
  folder: string,
  filename: string,
): Promise<MediaUploadResult> {
  const authToken = localStorage.getItem("auth-token") || "";
  if (!authToken) throw new Error("Sign in required to upload media.");

  const contentType = blob.type || "application/octet-stream";
  const url = await uploadOne(blob, folder, filename, contentType, authToken);

  let previewUrl: string | undefined;
  if (contentType.startsWith("image/")) {
    const previewBlob = await generatePreviewBlob(blob);
    if (previewBlob) {
      try {
        previewUrl = await uploadOne(
          previewBlob,
          folder,
          previewFilename(filename),
          "image/webp",
          authToken,
        );
      } catch {
        previewUrl = previewUrlForPublicUrl(url);
      }
    } else {
      previewUrl = previewUrlForPublicUrl(url);
    }
  }

  return { url, previewUrl };
}

/** Convenience when only the main URL is needed. */
export async function uploadPublicMediaUrl(
  blob: Blob,
  folder: string,
  filename: string,
): Promise<string> {
  const result = await uploadPublicMedia(blob, folder, filename);
  return result.url;
}
