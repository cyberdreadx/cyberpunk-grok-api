-- ============================================================
-- SaaS Credits Schema for Grok Imagine
-- Supports monthly subscriptions + one-time credit packs
-- ============================================================

-- 1. Profiles table — extends Supabase auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- Auto-create a profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, sub_credits, pack_credits)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Transactions table — credit purchase & subscription history
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
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
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
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
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;  -- lock the row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_total := v_sub + v_pack;
  IF v_total < p_amount THEN
    RAISE EXCEPTION 'Insufficient credits. Need %, have %', p_amount, v_total;
  END IF;

  -- Deduct from sub_credits first
  v_from_sub := LEAST(v_sub, p_amount);
  v_from_pack := p_amount - v_from_sub;

  UPDATE public.profiles
  SET sub_credits = sub_credits - v_from_sub,
      pack_credits = pack_credits - v_from_pack,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC: add pack credits (used by webhook for one-time packs)
CREATE OR REPLACE FUNCTION public.add_pack_credits(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
BEGIN
  INSERT INTO public.profiles (id, pack_credits, updated_at)
  VALUES (p_user_id, p_amount, now())
  ON CONFLICT (id) DO UPDATE
  SET pack_credits = public.profiles.pack_credits + p_amount,
      updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC: reset subscription credits (used by webhook on invoice.paid)
CREATE OR REPLACE FUNCTION public.reset_sub_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_tier TEXT,
  p_renews_at TIMESTAMPTZ
)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET sub_credits = p_amount,
      subscription_tier = p_tier,
      subscription_renews_at = p_renews_at,
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, sub_credits, subscription_tier, subscription_renews_at)
    VALUES (p_user_id, p_amount, p_tier, p_renews_at);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC: clear subscription on cancellation
CREATE OR REPLACE FUNCTION public.clear_subscription(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET sub_credits = 0,
      subscription_tier = NULL,
      subscription_renews_at = NULL,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Keep backwards-compatible add_credits for any existing callers
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
BEGIN
  -- Alias to add_pack_credits for backward compatibility
  PERFORM public.add_pack_credits(p_user_id, p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_log ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Profiles: users can update their own byok_enabled flag only
CREATE POLICY "Users can update own byok flag"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Transactions: users can read their own transactions
CREATE POLICY "Users can read own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Usage log: users can read their own usage
CREATE POLICY "Users can read own usage"
  ON public.usage_log FOR SELECT
  USING (auth.uid() = user_id);

-- Enable realtime for profiles (for credit balance updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_log_user_id ON public.usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON public.usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON public.profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
