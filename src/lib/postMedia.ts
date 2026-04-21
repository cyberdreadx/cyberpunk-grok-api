/**
 * Shared helper: take a library `GrokResult` and turn it into a permanent,
 * publicly-accessible URL suitable for posting to feed/stories.
 *
 * Mirrors the logic that lived inline in ResultsGrid so it can be reused
 * by the FeedPage compose flow's library picker.
 */

import { upload } from "@vercel/blob/client";
import { apiUrl } from "@/lib/api";
import { getResultDataUrl } from "@/lib/storage";
import type { GrokResult } from "@/hooks/useGrokApi";

export async function uploadLibraryItemForPost(result: GrokResult): Promise<string> {
  const apiBase = apiUrl("");
  let mediaUrl = result.url;

  // Already on permanent storage? Reuse as-is.
  if (mediaUrl.includes("blob.vercel-storage.com")) return mediaUrl;

  let mediaBlob: Blob | null = null;
  const src = result.url;

  if (src.startsWith("data:")) {
    mediaBlob = await fetch(src).then((r) => r.blob());
  } else {
    const stored = await getResultDataUrl(result.id).catch(() => null);
    if (stored && stored.startsWith("data:")) {
      mediaBlob = await fetch(stored).then((r) => r.blob());
    } else if (src.startsWith("https://") || src.startsWith("http://")) {
      // Remote URL — let the server proxy + persist it (handles CORS/expiry).
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
      if (!dlRes.ok) throw new Error("Failed to upload media");
      const dlData = await dlRes.json();
      return dlData.r2Url || dlData.url;
    } else if (src.startsWith("blob:")) {
      const resp = await fetch(src);
      if (!resp.ok) throw new Error("Failed to fetch media from blob URL");
      mediaBlob = await resp.blob();
    }
  }

  if (!mediaBlob) {
    throw new Error("Could not resolve media for upload");
  }

  const ext = result.type === "video" ? "mp4" : "png";
  const authToken = localStorage.getItem("auth-token") || "";
  const { url: blobUrl } = await upload(`feed/post.${ext}`, mediaBlob, {
    access: "public",
    handleUploadUrl: `${apiBase}/blob-upload`,
    clientPayload: authToken,
  });
  return blobUrl;
}
