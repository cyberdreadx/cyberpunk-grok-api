/**
 * Global kill switch for all free-credit sources (daily reset, spin wheel,
 * daily missions). Toggle by setting the env var FREE_CREDITS_DISABLED=true
 * in Vercel. Paid purchases (Stripe / XRGE) are NOT affected.
 */
export function freeCreditsDisabled(): boolean {
  const v = (process.env.FREE_CREDITS_DISABLED || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

export const FREE_CREDITS_MAINTENANCE_MESSAGE =
  "Free credits are temporarily paused for maintenance. Paid credits and subscriptions are unaffected — check back soon.";
