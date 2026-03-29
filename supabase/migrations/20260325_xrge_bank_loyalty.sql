-- ============================================================
-- XRGE Bank & Loyalty Tiers
-- Custodial XRGE balance, deposit/withdraw/spend, loyalty rewards
-- ============================================================

-- 1. New columns on users for XRGE bank
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS xrge_bank_balance NUMERIC(36,18) NOT NULL DEFAULT 0
    CHECK (xrge_bank_balance >= 0),
  ADD COLUMN IF NOT EXISTS xrge_lifetime_spend NUMERIC(36,18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS loyalty_tier TEXT NOT NULL DEFAULT 'bronze';

CREATE INDEX IF NOT EXISTS idx_users_wallet_address
  ON public.users(wallet_address) WHERE wallet_address IS NOT NULL;

-- 2. XRGE bank transaction ledger
CREATE TABLE IF NOT EXISTS public.xrge_bank_txns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- 'deposit' | 'withdraw' | 'purchase' | 'refund'
  type TEXT NOT NULL,
  -- Positive for deposits/refunds, negative for withdrawals/purchases
  amount NUMERIC(36,18) NOT NULL,
  balance_after NUMERIC(36,18) NOT NULL,
  -- On-chain tx hash for deposits/withdrawals
  tx_hash TEXT,
  -- Credit pack ID if this was a purchase
  package TEXT,
  credits_awarded INTEGER,
  bonus_credits INTEGER,
  loyalty_tier_at TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xrge_bank_txns_user
  ON public.xrge_bank_txns(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_xrge_bank_txns_tx_hash
  ON public.xrge_bank_txns(tx_hash) WHERE tx_hash IS NOT NULL AND type = 'deposit';

-- 3. Withdrawal requests (admin-approved for security)
CREATE TABLE IF NOT EXISTS public.xrge_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC(36,18) NOT NULL CHECK (amount > 0),
  to_address TEXT NOT NULL,
  -- 'pending' | 'processing' | 'completed' | 'rejected'
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_xrge_withdrawals_user
  ON public.xrge_withdrawals(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xrge_withdrawals_status
  ON public.xrge_withdrawals(status) WHERE status = 'pending';
