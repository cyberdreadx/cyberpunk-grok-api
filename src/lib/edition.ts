/**
 * Which edition of the app this is: GLTCH Runner, GLTCH Studio or GLTCH Web3.
 *
 * One codebase, one backend, one set of accounts and credits — two faces.
 * Runner is the full cyberpunk app. Studio, served at studio.gltchrunner.com, is
 * the plain consumer edition: a clean light theme, only the pages a normal
 * creator needs (create, library, account), no feed / stories / chat /
 * creators / terminal, and SFW only.
 *
 * Web3, served at web3.gltchrunner.com, is Runner paid in crypto: the same
 * app and community, but every generation is paid in XRGE from the user's
 * bank balance instead of credits, and there is nothing to buy with a card.
 * The API is told with the X-Gltch-Edition header (src/lib/api.ts) and does
 * the charging (api/_lib/web3-spend.ts).
 *
 * Decided by hostname so nothing has to be configured per deploy. For testing
 * on the main domain, ?edition=studio (or ?edition=runner) sets a sticky
 * override in localStorage.
 *
 * This module imports nothing, on purpose: themes, immersion and routing all
 * read it during boot, and a cycle here would decide the edition after the
 * first paint — exactly the flash this exists to prevent.
 */

export type Edition = "runner" | "studio" | "web3";

const STUDIO_HOSTS = new Set(["studio.gltchrunner.com"]);
const WEB3_HOSTS = new Set(["web3.gltchrunner.com"]);
const isEdition = (v: string | null): v is Edition => v === "studio" || v === "runner" || v === "web3";
const OVERRIDE_KEY = "gltch-edition-override";

function detect(): Edition {
  if (typeof window === "undefined") return "runner";
  try {
    const q = new URLSearchParams(window.location.search).get("edition");
    if (isEdition(q)) localStorage.setItem(OVERRIDE_KEY, q);
    const o = localStorage.getItem(OVERRIDE_KEY);
    if (isEdition(o)) return o;
  } catch { /* storage blocked — fall through to hostname */ }
  const host = window.location.hostname;
  return STUDIO_HOSTS.has(host) ? "studio" : WEB3_HOSTS.has(host) ? "web3" : "runner";
}

export const EDITION: Edition = detect();
export const isStudio = EDITION === "studio";
export const isWeb3 = EDITION === "web3";

export const BRAND_NAME = isStudio ? "GLTCH Studio" : isWeb3 ? "GLTCH Web3" : "GLTCH Runner";
