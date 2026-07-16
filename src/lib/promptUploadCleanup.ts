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
  const endpoint = apiUrl("/library-purge");
  const payload = JSON.stringify({ urls, clientPayload: token });

  // sendBeacon with a default (text/plain) body is a CORS "simple request" —
  // no preflight, and the browser guarantees delivery outlives the page.
  // A keepalive fetch needs an OPTIONS preflight that can be dropped during
  // unload, so it's only the fallback. Token travels in the body because
  // neither transport can set an Authorization header reliably here.
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, payload)) return;
  } catch {
    // fall through
  }
  try {
    void fetch(endpoint, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: payload,
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
