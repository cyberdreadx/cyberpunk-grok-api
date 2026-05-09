/**
 * Shared helper: take a library `GrokResult` and turn it into a permanent,
 * publicly-accessible URL suitable for posting to feed/stories.
 */

import { upload } from "@vercel/blob/client";
import { apiUrl } from "@/lib/api";
import { getResultDataUrl } from "@/lib/storage";
import type { GrokResult } from "@/hooks/useGrokApi";

/** Hosts whose URLs are already permanent + public — safe to reuse as-is. */
function isPermanentPublicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h.endsWith("blob.vercel-storage.com")) return true;
    if (h.endsWith(".r2.dev")) return true; // pub-xxxxx.r2.dev
    if (h.endsWith(".r2.cloudflarestorage.com")) return true;
    return false;
  } catch {
    return false;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function uploadBlobDirect(blob: Blob, type: "image" | "video"): Promise<string> {
  const apiBase = apiUrl("");
  const ext = type === "video" ? "mp4" : "png";
  const authToken = localStorage.getItem("auth-token") || "";
  if (!authToken) {
    throw new Error("Sign in required to attach media to a post.");
  }
  try {
    const { url: blobUrl } = await upload(`feed/post.${ext}`, blob, {
      access: "public",
      handleUploadUrl: `${apiBase}/blob-upload`,
      clientPayload: authToken,
    });
    return blobUrl;
  } catch (e: any) {
    const raw = String(e?.message || e || "").toLowerCase();
    if (raw.includes("unauthorized") || raw.includes("401")) {
      throw new Error("Your session expired — sign in again to post media.");
    }
    if (raw.includes("not configured") || raw.includes("503")) {
      throw new Error("Media uploads are temporarily unavailable. Try again shortly.");
    }
    if (raw.includes("load failed") || raw.includes("failed to fetch") || raw.includes("network")) {
      throw new Error("Network error uploading media — check your connection and retry.");
    }
    throw new Error(`Upload failed: ${e?.message || "unknown error"}`);
  }
}

export async function uploadLibraryItemForPost(result: GrokResult): Promise<string> {
  const src = result.url;

  // Already on a permanent public host? Reuse as-is.
  if (isPermanentPublicUrl(src)) return src;

  // 1) Try to resolve the bytes locally (data URL, IndexedDB cache, blob: URL)
  let mediaBlob: Blob | null = null;

  if (src.startsWith("data:")) {
    try { mediaBlob = await fetch(src).then((r) => r.blob()); } catch {}
  }

  if (!mediaBlob) {
    try {
      const stored = await getResultDataUrl(result.id);
      if (stored && stored.startsWith("data:")) {
        mediaBlob = await fetch(stored).then((r) => r.blob());
      }
    } catch {}
  }

  if (!mediaBlob && src.startsWith("blob:")) {
    try {
      const resp = await fetch(src);
      if (resp.ok) mediaBlob = await resp.blob();
    } catch {}
  }

  // 2) If we have bytes locally, upload directly to Vercel Blob (best path).
  if (mediaBlob) {
    try {
      return await uploadBlobDirect(mediaBlob, result.type);
    } catch (directErr) {
      // Fallback: base64 → /api/share (server-side blob upload, avoids browser→blob CORS issues)
      try {
        const base64 = await blobToBase64(mediaBlob);
        const token = localStorage.getItem("auth-token");
        const resp = await fetch(apiUrl("/share"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            mediaBase64: base64,
            mediaType: result.type === "video" ? "video/mp4" : "image/png",
            prompt: result.revised_prompt || "",
          }),
        });
        if (resp.ok) {
          const j = await resp.json();
          if (j?.r2Url || j?.url) return j.r2Url || j.url;
        }
      } catch {}
      throw directErr;
    }
  }

  // 3) Remote URL with no local bytes — try to fetch in browser first.
  if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const resp = await fetch(src, { mode: "cors" });
      if (resp.ok) {
        const blob = await resp.blob();
        return uploadBlobDirect(blob, result.type);
      }
    } catch {
      // CORS or network — fall through to server proxy.
    }

    // 4) Last resort: ask the server to download + persist (handles CORS / private CDNs).
    const token = localStorage.getItem("auth-token");
    let dlRes: Response;
    try {
      dlRes = await fetch(apiUrl("/share"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          mediaUrl: src,
          mediaType: result.type,
          prompt: result.revised_prompt || "",
        }),
      });
    } catch (e: any) {
      throw new Error(`Network error reaching server: ${e?.message || "load failed"}`);
    }

    if (!dlRes.ok) {
      let detail = "";
      try {
        const j = await dlRes.json();
        detail = j?.error || "";
      } catch {}
      throw new Error(
        detail
          ? `Server upload failed: ${detail}`
          : `Server upload failed (${dlRes.status}). The original media may have expired — try regenerating it.`
      );
    }
    const dlData = await dlRes.json();
    return dlData.r2Url || dlData.url;
  }

  throw new Error("Could not resolve media for upload — file may have been deleted from your device.");
}
