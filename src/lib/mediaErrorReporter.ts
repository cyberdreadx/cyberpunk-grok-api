/**
 * Client-side reporter for failed media loads.
 *
 * Posts to /api/media-errors with the original URL, kind (image/video) and
 * an arbitrary `source` tag (e.g. "feed-card"). De-duplicates within a
 * single page-load so a flapping <video> doesn't spam the endpoint.
 *
 * Failures are silently swallowed — telemetry must never break the UI.
 */

import { apiUrl } from "@/lib/api";

const SEEN = new Set<string>();

export function reportMediaError(
  url: string,
  kind: "image" | "video",
  source: string = "feed-card",
) {
  if (!url) return;
  const key = `${kind}::${source}::${url}`;
  if (SEEN.has(key)) return;
  SEEN.add(key);

  // Best-effort; never await.
  try {
    const token = localStorage.getItem("auth-token");
    fetch(apiUrl("/media-errors"), {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url, kind, source }),
    }).catch(() => {});
  } catch {}
}
