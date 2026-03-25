-- ============================================================
-- Daily Free Credits — 10/day for all verified users, no rollover
-- ============================================================

-- 1. Add daily_credits column and reset timestamp
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS daily_credits INTEGER NOT NULL DEFAULT 0 CHECK (daily_credits >= 0),
  ADD COLUMN IF NOT EXISTS daily_credits_reset_at TIMESTAMPTZ;

-- 2. Grant existing verified users their first daily allotment
UPDATE public.users
SET daily_credits = 10,
    daily_credits_reset_at = now()
WHERE email_verified = true;

-- 3. Replace deduct_credits to consume daily → sub → pack
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
DECLARE
  v_daily INTEGER;
  v_sub   INTEGER;
  v_pack  INTEGER;
  v_total INTEGER;
  v_from_daily INTEGER;
  v_from_sub   INTEGER;
  v_from_pack  INTEGER;
  v_remainder  INTEGER;
BEGIN
  SELECT daily_credits, sub_credits, pack_credits
  INTO v_daily, v_sub, v_pack
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_total := v_daily + v_sub + v_pack;
  IF v_total < p_amount THEN
    RAISE EXCEPTION 'Insufficient credits. Need %, have %', p_amount, v_total;
  END IF;

  v_from_daily := LEAST(v_daily, p_amount);
  v_remainder  := p_amount - v_from_daily;
  v_from_sub   := LEAST(v_sub, v_remainder);
  v_from_pack  := v_remainder - v_from_sub;

  UPDATE public.users
  SET daily_credits = daily_credits - v_from_daily,
      sub_credits   = sub_credits   - v_from_sub,
      pack_credits  = pack_credits  - v_from_pack,
      updated_at    = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
