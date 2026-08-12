-- 055: per-day rollup of Stripe's balance-transaction ledger.
--
-- The finance panel reads Stripe directly so it can report fees, refunds and
-- chargebacks that our own transactions table never sees. But a six-month pull
-- is ~90 sequential cursor pages and took 38 seconds, which is not a page you
-- can leave a range picker on.
--
-- A past day is immutable: a refund issued today lands on today's ledger, not
-- on the day of the original charge. So every day before the current one can be
-- cached forever and only the tail re-fetched. 180 days is 180 rows.
--
-- Money columns are BIGINT cents, matching Stripe's own integer minor units —
-- no floats anywhere in the path.

CREATE TABLE IF NOT EXISTS stripe_daily_cache (
  day               DATE PRIMARY KEY,
  gross_cents       BIGINT NOT NULL DEFAULT 0,
  fee_cents         BIGINT NOT NULL DEFAULT 0,
  refund_cents      BIGINT NOT NULL DEFAULT 0,
  adjustment_cents  BIGINT NOT NULL DEFAULT 0,
  other_fee_cents   BIGINT NOT NULL DEFAULT 0,
  charge_count      INTEGER NOT NULL DEFAULT 0,
  refund_count      INTEGER NOT NULL DEFAULT 0,
  adjustment_count  INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
