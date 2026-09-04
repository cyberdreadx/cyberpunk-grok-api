/**
 * Keep an installed PWA from serving a stale build forever.
 *
 * vite-plugin-pwa's generated registerSW.js registers the worker inside a
 * `load` listener and never asks again. A browser tab fires `load` on every
 * visit, so it picks up new deploys naturally. An installed PWA resumed from
 * the app switcher does not fire `load` at all — it just resumes — so it goes
 * on serving whatever it precached at install time. That is how a shipped CSS
 * change could animate in a browser tab and stay frozen in the installed app.
 *
 * Checking on `visibilitychange` covers the case the generated script misses:
 * every time the app comes back to the foreground.
 *
 * skipWaiting and clientsClaim are already set in vite.config.ts, so a worker
 * found here activates and claims the page immediately. The page is still
 * showing the old assets at that point, so `controllerchange` reloads it once
 * — guarded, because that event also fires the first time a worker ever claims
 * a page, and reloading a first-time visitor for no reason is worse than the
 * staleness this fixes.
 */

/** Foreground checks any closer together than this are pointless. */
const MIN_INTERVAL_MS = 60_000;

export function watchForUpdates(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  // Captured before anything can change it: if there is no controller yet then
  // this page load is the first install, and the claim that follows is not an
  // update worth reloading for.
  const hadController = !!navigator.serviceWorker.controller;

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  let lastCheck = 0;
  const check = () => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastCheck < MIN_INTERVAL_MS) return;
    lastCheck = now;
    void navigator.serviceWorker.getRegistration()
      .then((reg) => reg?.update())
      .catch(() => { /* offline, or the worker is gone — nothing to do */ });
  };

  document.addEventListener("visibilitychange", check);
  // Also on first run, for a PWA cold-started straight into the foreground.
  check();
}
