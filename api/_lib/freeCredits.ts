/**
 * Global kill switch for all free-credit sources (daily reset, spin wheel,
 * daily missions). Default is DISABLED — free credits are paused until further
 * notice. To re-enable, set FREE_CREDITS_ENABLED=true in Vercel env.
 *
 * The legacy FREE_CREDITS_DISABLED=true override still forces disabled.
 * Reddit posting reward (api/reddit-reward.ts) is intentionally NOT gated by
 * this flag — it remains active.
 */
export function freeCreditsDisabled(): boolean {
  const forced = (process.env.FREE_CREDITS_DISABLED || "").toLowerCase().trim();
  if (forced === "true" || forced === "1" || forced === "yes") return true;
  const enabled = (process.env.FREE_CREDITS_ENABLED || "").toLowerCase().trim();
  // Default: disabled. Only enabled if explicitly turned on.
  return !(enabled === "true" || enabled === "1" || enabled === "yes");
}

export const FREE_CREDITS_MAINTENANCE_MESSAGE =
  "Free credits are temporarily paused. Paid credits and subscriptions are unaffected — check back soon.";

