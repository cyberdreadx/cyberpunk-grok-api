/**
 * Shared helper: take a library `GrokResult` and turn it into a permanent,
 * publicly-accessible URL suitable for posting to feed/stories.
 */

import { apiUrl } from "@/lib/api";
import { getResultDataUrl } from "@/lib/storage";
import { isPermanentPublicMediaUrl, uploadPublicMedia } from "@/lib/mediaUpload";
import type { GrokResult } from "@/hooks/useGrokApi";

async function uploadBlobDirect(blob: Blob, type: "image" | "video"): Promise<string> {
  const ext = type === "video" ? "mp4" : "png";
  return uploadPublicMedia(blob, type === "video" ? "feed" : "feed", `post.${ext}`);
}

export async function uploadLibraryItemForPost(result: GrokResult): Promise<string> {
  const src = result.url;

  if (isPermanentPublicMediaUrl(src)) return src;

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
      return await uploadBlobDirect(mediaBlob, result.type);
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
          if (j?.r2Url || j?.url) return j.r2Url || j.url;
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
        return uploadBlobDirect(blob, result.type);
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
    return dlData.r2Url || dlData.url;
  }

  throw new Error("Could not resolve media for upload — file may have been deleted from your device.");
}
