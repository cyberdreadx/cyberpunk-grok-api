-- ============================================================
-- SaaS Credits Schema for Grok Imagine
-- For Neon Postgres (no Supabase-specific features)
-- ============================================================

-- Enable uuid extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users table (owns auth — no external auth provider)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- Subscription credits reset each billing cycle (no rollover)
  sub_credits INTEGER NOT NULL DEFAULT 0 CHECK (sub_credits >= 0),
  -- One-time pack credits never expire
  pack_credits INTEGER NOT NULL DEFAULT 0 CHECK (pack_credits >= 0),
  -- Stripe customer ID for subscription management / portal
  stripe_customer_id TEXT,
  -- Current subscription tier: 'basic' | 'premium' | null
  subscription_tier TEXT,
  -- When the current subscription period renews (credits reset)
  subscription_renews_at TIMESTAMPTZ,
  byok_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Transactions table — credit purchase & subscription history
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT,
  package TEXT,
  -- 'pack' for one-time purchases, 'subscription' for monthly renewals
  type TEXT NOT NULL DEFAULT 'pack',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Usage log — generation history for billing transparency
CREATE TABLE IF NOT EXISTS public.usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. RPC: atomic credit deduction — consume sub_credits first, overflow to pack_credits
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
DECLARE
  v_sub INTEGER;
  v_pack INTEGER;
  v_total INTEGER;
  v_from_sub INTEGER;
  v_from_pack INTEGER;
BEGIN
  SELECT sub_credits, pack_credits
  INTO v_sub, v_pack
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;  -- lock the row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_total := v_sub + v_pack;
  IF v_total < p_amount THEN
    RAISE EXCEPTION 'Insufficient credits. Need %, have %', p_amount, v_total;
  END IF;

  -- Deduct from sub_credits first
  v_from_sub := LEAST(v_sub, p_amount);
  v_from_pack := p_amount - v_from_sub;

  UPDATE public.users
  SET sub_credits = sub_credits - v_from_sub,
      pack_credits = pack_credits - v_from_pack,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 5. RPC: add pack credits (used by webhook for one-time packs)
CREATE OR REPLACE FUNCTION public.add_pack_credits(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET pack_credits = pack_credits + p_amount,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 6. RPC: reset subscription credits (used by webhook on invoice.paid)
CREATE OR REPLACE FUNCTION public.reset_sub_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_tier TEXT,
  p_renews_at TIMESTAMPTZ
)
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET sub_credits = p_amount,
      subscription_tier = p_tier,
      subscription_renews_at = p_renews_at,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 7. RPC: clear subscription on cancellation
CREATE OR REPLACE FUNCTION public.clear_subscription(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET sub_credits = 0,
      subscription_tier = NULL,
      subscription_renews_at = NULL,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 8. Processed events — webhook idempotency
CREATE TABLE IF NOT EXISTS public.processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Referrals table
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referee_purchased BOOLEAN NOT NULL DEFAULT false,
  referrer_rewarded BOOLEAN NOT NULL DEFAULT false,
  referee_purchase_reward BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(referrer_id, referee_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON public.users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_session ON public.transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_log_user_id ON public.usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON public.usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON public.referrals(referee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

-- Unique constraint for idempotent pack transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_stripe_session_unique
  ON public.transactions(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
