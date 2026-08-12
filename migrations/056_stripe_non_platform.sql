-- 056: separate non-platform revenue in the Stripe day cache.
--
-- The Stripe account carries charges that aren't GLTCH Runner revenue —
-- `type: "ticket"` checkout sessions from an event the owner used to run,
-- 85 of them between 2026-02-28 and 2026-07-01. Counting those as platform
-- gross both overstated revenue and made the ledger reconciliation look
-- $1,035 worse than it is, since no webhook will ever write a row for them.
--
-- Which metadata types count as non-platform is configurable via
-- STRIPE_NON_PLATFORM_TYPES (comma-separated, default "ticket").

ALTER TABLE stripe_daily_cache
  ADD COLUMN IF NOT EXISTS non_platform_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS non_platform_count INTEGER NOT NULL DEFAULT 0;
