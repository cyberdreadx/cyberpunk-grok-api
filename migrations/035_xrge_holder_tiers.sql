-- ============================================================
-- XRGE Holder Tiers (P1 — long-term holder strategy)
--
-- Rewards users for HOLDING XRGE (on-chain wallet + bank combined),
-- separate from the spend-based loyalty tier system already in place.
--
-- A daily cron (api/cron-xrge-snapshot.ts) reads the on-chain balance
-- for each user's bound wallet, sums it with their custodial bank
-- balance, computes the holder tier, and persists a snapshot row.
--
-- Holder tier ladder (XRGE held):
--   none      < 1,000,000          — no perks (prompt to start holding)
--   initiate  ≥ 1,000,000          — +5%  gen discount
--   operative ≥ 10,000,000         — +10% discount, +2  daily credits
--   runner    ≥ 50,000,000         — +15% discount, +5  daily credits, NSFW LoRA
--   architect ≥ 250,000,000        — +25% discount, +10 daily credits, GLTCH PRO
--
-- Continuous-hold streak multiplier (applied to perks above):
--   30+ days  → 1.25×
--   90+ days  → 1.50×
--   180+ days → 2.00×
-- Selling below the tier threshold resets the streak.
-- ============================================================

-- Holder tier columns on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS holder_tier TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS holder_tier_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_snapshot_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_snapshot_total NUMERIC(36,18) NOT NULL DEFAULT 0;

-- Daily snapshot ledger. Trimmed to a 30-day rolling window by the cron.
CREATE TABLE IF NOT EXISTS public.xrge_holder_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_balance NUMERIC(36,18) NOT NULL DEFAULT 0,  -- on-chain
  bank_balance   NUMERIC(36,18) NOT NULL DEFAULT 0,  -- custodial
  total_held     NUMERIC(36,18) NOT NULL DEFAULT 0,
  tier           TEXT NOT NULL DEFAULT 'none',
  taken_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holder_snapshots_user_taken
  ON public.xrge_holder_snapshots(user_id, taken_at DESC);

CREATE INDEX IF NOT EXISTS idx_holder_snapshots_taken
  ON public.xrge_holder_snapshots(taken_at DESC);

-- Helpful index for cron eligibility scan (users who are holders)
CREATE INDEX IF NOT EXISTS idx_users_holder_eligible
  ON public.users(id)
  WHERE wallet_address IS NOT NULL OR xrge_bank_balance > 0;
