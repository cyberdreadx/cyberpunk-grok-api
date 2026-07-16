/**
 * Session cleanup for generation-input uploads (the `prompts/` R2 folder).
 *
 * Input images only need to live for the duration of the session that uses
 * them — they are privacy-sensitive (users' own photos) and nothing
 * references them afterwards. Every prompts/ upload is tracked here, and on
 * pagehide a keepalive purge request deletes them server-side. The daily
 * cron-r2-orphans sweep (24h window) catches anything this misses (crashed
 * tab, dropped network).
 */
import { apiUrl } from "@/lib/api";

const tracked = new Set<string>();
let listenerInstalled = false;

function flush() {
  if (tracked.size === 0) return;
  const token = localStorage.getItem("auth-token");
  if (!token) return;
  const urls = [...tracked];
  tracked.clear();
  try {
    // keepalive lets the request outlive the unloading page (and, unlike
    // sendBeacon, carries the Authorization header the endpoint needs).
    void fetch(apiUrl("/library-purge"), {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ urls }),
    });
  } catch {
    // Page is going away — the daily sweep is the fallback.
  }
}

/** Record a transient generation-input upload for end-of-session deletion. */
export function trackPromptUpload(url: string) {
  if (!url || !/^https?:/i.test(url)) return;
  tracked.add(url);
  if (!listenerInstalled) {
    listenerInstalled = true;
    // pagehide fires on tab close, navigation away, and (on mobile) app
    // switch that discards the page; visibilitychange→hidden would purge
    // too eagerly while the user is still mid-session.
    window.addEventListener("pagehide", flush);
  }
}
