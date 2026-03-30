-- ============================================================
-- XRGE Bank & Loyalty Tiers
-- Custodial XRGE bank with deposit, purchase, withdraw,
-- plus lifetime spend tracking for loyalty tier bonuses.
-- ============================================================

-- Bank balance + loyalty columns on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS xrge_bank_balance NUMERIC(36,18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS xrge_lifetime_spend NUMERIC(36,18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_tier TEXT NOT NULL DEFAULT 'bronze',
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- Bank transaction ledger
CREATE TABLE IF NOT EXISTS public.xrge_bank_txns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'purchase', 'withdrawal', 'refund')),
  amount NUMERIC(36,18) NOT NULL,
  balance_after NUMERIC(36,18) NOT NULL,
  tx_hash TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xrge_bank_txns_user ON public.xrge_bank_txns(user_id, created_at DESC);

-- Withdrawal requests
CREATE TABLE IF NOT EXISTS public.xrge_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC(36,18) NOT NULL,
  to_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_xrge_withdrawals_user ON public.xrge_withdrawals(user_id, created_at DESC);
