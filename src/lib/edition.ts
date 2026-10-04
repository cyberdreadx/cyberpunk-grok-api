/**
 * Which edition of the app this is: GLTCH Runner, or GLTCH Studio.
 *
 * One codebase, one backend, one set of accounts and credits — two faces.
 * Runner is the full cyberpunk app. Studio, served at studio.gltchrunner.com, is
 * the plain consumer edition: a clean light theme, only the pages a normal
 * creator needs (create, library, account), no feed / stories / chat /
 * creators / terminal, and SFW only.
 *
 * Decided by hostname so nothing has to be configured per deploy. For testing
 * on the main domain, ?edition=studio (or ?edition=runner) sets a sticky
 * override in localStorage.
 *
 * This module imports nothing, on purpose: themes, immersion and routing all
 * read it during boot, and a cycle here would decide the edition after the
 * first paint — exactly the flash this exists to prevent.
 */

export type Edition = "runner" | "studio";

const STUDIO_HOSTS = new Set(["studio.gltchrunner.com"]);
const OVERRIDE_KEY = "gltch-edition-override";

function detect(): Edition {
  if (typeof window === "undefined") return "runner";
  try {
    const q = new URLSearchParams(window.location.search).get("edition");
    if (q === "studio" || q === "runner") localStorage.setItem(OVERRIDE_KEY, q);
    const o = localStorage.getItem(OVERRIDE_KEY);
    if (o === "studio" || o === "runner") return o;
  } catch { /* storage blocked — fall through to hostname */ }
  return STUDIO_HOSTS.has(window.location.hostname) ? "studio" : "runner";
}

export const EDITION: Edition = detect();
export const isStudio = EDITION === "studio";

export const BRAND_NAME = isStudio ? "GLTCH Studio" : "GLTCH Runner";
