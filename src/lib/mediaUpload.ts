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

/**
 * Best-effort userId from the auth JWT so fallback Blob paths are
 * user-scoped (<folder>/<userId>/…) — that's what lets library-purge
 * prove ownership and delete them on session close.
 */
function userIdFromToken(token: string): string | null {
  try {
    const seg = token.split(".")[1] || "";
    const payload = JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.userId === "string" && payload.userId ? payload.userId : null;
  } catch {
    return null;
  }
}

function previewFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}-preview.webp`;
}

/** Blob -> bare base64 (no data: prefix), for the relay upload path. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
    // Auth errors should surface immediately — no silent fallback.
    if (/unauthorized|sign in required/i.test(msg)) {
      throw err;
    }
    console.warn("[mediaUpload] direct-to-R2 failed, relaying through the API:", msg);
  }

  // Relay through the API. The presigned PUT above is cross-origin and needs a
  // CORS policy on the bucket; when that's missing the browser preflight is
  // rejected and the direct path can never work. This one has no CORS surface,
  // so it keeps uploads alive regardless of bucket config — at the cost of a
  // hop through the server, hence direct-to-R2 staying the preferred path.
  try {
    const dataBase64 = await blobToBase64(blob);
    const relayed = await apiFetch<{ url: string }>("/media-upload", {
      method: "POST",
      body: { action: "proxy", folder, filename, contentType, dataBase64, clientPayload: authToken },
    });
    if (relayed?.url) return relayed.url;
  } catch (relayErr: any) {
    console.warn("[mediaUpload] relay upload failed, falling back to Vercel Blob:", relayErr?.message || relayErr);
  }

  const ext =
    contentType === "image/png" ? "png"
    : contentType === "image/webp" ? "webp"
    : contentType.startsWith("video/") ? (contentType.split("/")[1] || "mp4")
    : "jpg";
  const uid = userIdFromToken(authToken);
  const safeName = `${folder}/${uid ? `${uid}/` : ""}${Date.now()}-${filename.replace(/[^\w.-]/g, "_") || "upload"}.${ext}`;
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
