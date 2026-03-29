-- ============================================================
-- XRGE Loyalty Tiers
-- Track lifetime XRGE spend for loyalty tier bonuses on purchases
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS xrge_lifetime_spend NUMERIC(36,18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_tier TEXT NOT NULL DEFAULT 'bronze';
