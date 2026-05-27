/**
 * Shared helper: take a library `GrokResult` and turn it into a permanent,
 * publicly-accessible URL suitable for posting to feed/stories.
 */

import { apiUrl } from "@/lib/api";
import { getResultDataUrl } from "@/lib/storage";
import { isPermanentPublicMediaUrl, uploadPublicMedia } from "@/lib/mediaUpload";
import { previewUrlForPublicUrl } from "@/lib/previewUrl";
import type { GrokResult } from "@/hooks/useGrokApi";

export type LibraryUploadResult = { url: string; previewUrl?: string };

async function uploadBlobDirect(blob: Blob, type: "image" | "video"): Promise<LibraryUploadResult> {
  const ext = type === "video" ? "mp4" : "jpg";
  return uploadPublicMedia(blob, "feed", `post.${ext}`);
}

export async function uploadLibraryItemForPost(result: GrokResult): Promise<LibraryUploadResult> {
  const src = result.url;

  if (isPermanentPublicMediaUrl(src)) {
    return { url: src, previewUrl: previewUrlForPublicUrl(src) };
  }

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

  if (mediaBlob) {
    try {
      const uploaded = await uploadBlobDirect(mediaBlob, result.type);
      return uploaded;
    } catch (directErr) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(",")[1] || "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(mediaBlob!);
        });
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
          const url = j?.r2Url || j?.url;
          if (url) return { url, previewUrl: previewUrlForPublicUrl(url) };
        }
      } catch {}
      throw directErr;
    }
  }

  if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const resp = await fetch(src, { mode: "cors" });
      if (resp.ok) {
        const blob = await resp.blob();
        const uploaded = await uploadBlobDirect(blob, result.type);
        return uploaded;
      }
    } catch {
      /* server proxy */
    }

    const token = localStorage.getItem("auth-token");
    const dlRes = await fetch(apiUrl("/share"), {
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

    if (!dlRes.ok) {
      let detail = "";
      try {
        const j = await dlRes.json();
        detail = j?.error || "";
      } catch {}
      throw new Error(
        detail
          ? `Server upload failed: ${detail}`
          : `Server upload failed (${dlRes.status}). The original media may have expired — try regenerating it.`,
      );
    }
    const dlData = await dlRes.json();
    const url = dlData.r2Url || dlData.url;
    return { url, previewUrl: previewUrlForPublicUrl(url) };
  }

  throw new Error("Could not resolve media for upload — file may have been deleted from your device.");
}
