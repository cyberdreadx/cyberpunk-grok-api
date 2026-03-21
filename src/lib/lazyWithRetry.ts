import React from "react";

/**
 * Wraps React.lazy() to handle stale chunk errors after deployments.
 *
 * When Vite rebuilds, chunk hashes change. Users with the app already open
 * will request old filenames that no longer exist, getting back HTML (404)
 * instead of JS — triggering "text/html is not a JavaScript MIME type".
 *
 * This helper catches that error and reloads the page once (using a
 * sessionStorage flag to prevent infinite reload loops).
 */
export function lazyWithRetry<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  chunkName?: string,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    const storageKey = `chunk-retry-${chunkName ?? "global"}`;
    const hasRetried = sessionStorage.getItem(storageKey);

    try {
      const module = await importFn();
      sessionStorage.removeItem(storageKey);
      return module;
    } catch (err) {
      if (!hasRetried) {
        sessionStorage.setItem(storageKey, "1");
        window.location.reload();
        // Return a never-resolving promise so React doesn't render stale state
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
