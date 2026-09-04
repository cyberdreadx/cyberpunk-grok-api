/**
 * Single source of truth for the app version.
 * Bump when deploying — UI, legal text, and the PWA web manifest (`vite.config.ts`) read from here.
 * Service worker updates still rely on hashed assets + `registerType: "autoUpdate"`; manifest `version`
 * helps humans, install prompts, and any tooling that reads the built `manifest.webmanifest`.
 */

/** Semver-style version shown in the header, HUD, and legal page */
export const APP_VERSION = "5.6";

/** Date-based build tag used by the changelog seen-check */
export const APP_BUILD = "2026.09.04";
