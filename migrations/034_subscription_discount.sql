-- 034_subscription_discount.sql
-- Subscription model change: instead of granting monthly credits,
-- subscriptions now apply a permanent per-generation discount while active.
-- This kills the cancel→resubscribe credit-farming loop.
--
-- discount_pct values: BASIC 15, PREMIUM 30, PRO 50, ELITE 70 (0 = no sub).
-- Set on invoice.paid; cleared on customer.subscription.deleted.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_discount_pct INT NOT NULL DEFAULT 0;

-- Backfill: existing active subscribers get the discount immediately so they're
-- not punished while their old sub_credits drain.
UPDATE users
SET subscription_discount_pct = CASE
  WHEN subscription_tier IN ('basic', 'basic-yearly') THEN 15
  WHEN subscription_tier IN ('premium', 'premium-yearly') THEN 30
  WHEN subscription_tier IN ('pro', 'pro-yearly') THEN 50
  WHEN subscription_tier IN ('elite', 'elite-yearly') THEN 70
  ELSE 0
END
WHERE subscription_tier IS NOT NULL
  AND subscription_discount_pct = 0;

-- Clear discount when subscription ends (used by clear_subscription fn if present).
-- Safe to re-run.
-- Drop any existing variant (parameter names can't change via CREATE OR REPLACE)
DROP FUNCTION IF EXISTS clear_subscription(uuid);

CREATE FUNCTION clear_subscription(p_user_id uuid)
RETURNS void
LANGUAGE sql
AS $body$
  UPDATE users
  SET subscription_tier = NULL,
      subscription_renews_at = NULL,
      subscription_cancel_at = NULL,
      subscription_discount_pct = 0,
      updated_at = now()
  WHERE id = p_user_id;
$body$;
