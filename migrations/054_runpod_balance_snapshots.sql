-- 054: RunPod account balance snapshots.
--
-- api_cost_cents is execution time × one flat rate (comfyui.ts:3181), which is
-- the H200 flex price applied to every endpoint even when a job lands on the
-- cheaper ADA workers those endpoints also list. It also cannot see idle-worker
-- time, cold starts, or the GPU seconds that get zeroed out when a job is
-- refunded. So the per-job number is an estimate and always will be.
--
-- This table is the correction: one row per snapshot of the real account
-- balance. Consecutive negative deltas are actual drawdown, which the admin
-- panel divides by the estimate to show how far off the flat rate is.
--
-- Deliberately tiny: one row a day is ~40 bytes, so no retention job. Six
-- months of history costs less than a single generation.

CREATE TABLE IF NOT EXISTS runpod_balance_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  balance_usd   NUMERIC(12, 6) NOT NULL,
  spend_per_hr  NUMERIC(12, 6),
  CONSTRAINT runpod_balance_snapshots_at_uniq UNIQUE (captured_at)
);

CREATE INDEX IF NOT EXISTS idx_runpod_snapshots_at
  ON runpod_balance_snapshots (captured_at DESC);
