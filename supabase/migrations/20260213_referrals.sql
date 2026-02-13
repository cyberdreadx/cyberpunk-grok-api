-- ============================================================
-- Referral System Schema
-- ============================================================

-- 1. Add referral columns to users table
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 2. Referrals tracking table
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  referee_verified BOOLEAN NOT NULL DEFAULT false,
  referee_purchased BOOLEAN NOT NULL DEFAULT false,
  referrer_rewarded BOOLEAN NOT NULL DEFAULT false,
  referee_signup_reward BOOLEAN NOT NULL DEFAULT false,
  referee_purchase_reward BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON public.referrals(referee_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON public.users(referral_code) WHERE referral_code IS NOT NULL;
