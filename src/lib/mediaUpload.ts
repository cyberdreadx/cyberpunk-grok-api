/**
 * Client media uploads — direct to Cloudflare R2 when available, else Vercel Blob.
 */
import { upload } from "@vercel/blob/client";
import { apiFetch, apiUrl } from "@/lib/api";

const R2_HOST_RE = /\.r2\.dev$|\.r2\.cloudflarestorage\.com$/i;

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

/**
 * Upload a file/blob to public storage.
 * @param folder  e.g. "feed", "stories", "avatars"
 * @param filename  e.g. "post.mp4"
 */
export async function uploadPublicMedia(
  blob: Blob,
  folder: string,
  filename: string,
): Promise<string> {
  const authToken = localStorage.getItem("auth-token") || "";
  if (!authToken) throw new Error("Sign in required to upload media.");

  const contentType = blob.type || "application/octet-stream";

  try {
    const presign = await apiFetch<{
      uploadUrl: string;
      publicUrl: string;
      storage: string;
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
    if (!putResp.ok) {
      throw new Error(`R2 upload failed (${putResp.status})`);
    }
    return presign.publicUrl;
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (!msg.includes("R2") && !msg.includes("503") && !msg.includes("not configured")) {
      throw err;
    }
    // Fallback: legacy Vercel Blob client upload
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
