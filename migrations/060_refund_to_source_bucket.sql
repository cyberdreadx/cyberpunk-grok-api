-- Refunds go back where the credits came from.
--
-- deduct_credits() drains daily -> sub -> pack and computes the split, then
-- discards it (RETURNS void). Every refund in api/comfyui.ts called
-- add_pack_credits(), which always credits the pack bucket. So a failed
-- generation paid for with expiring daily credits came back as permanent pack
-- credits: 31,142 credits refunded in the last year, every one of them
-- upgraded on the way back.
--
-- api/v1/_lib/credits.ts already restores each bucket by the amount taken.
-- This gives the app path the same ability:
--
--   deduct_credits_split()  — same logic, but returns what it took
--   usage_log.paid_*        — remembers the split so a refund issued by a
--                             later poll request can still reverse it exactly
--   refund_credits()        — puts each bucket back
--
-- add_pack_credits() is left alone: it is still the right call for genuine
-- grants (promos, support credits), which are pack credits by nature.

ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS paid_daily INT;
ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS paid_sub   INT;
ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS paid_pack  INT;

-- Same body as deduct_credits, but hands back the split it used.
CREATE OR REPLACE FUNCTION public.deduct_credits_split(
  p_user_id uuid,
  p_amount  integer
)
RETURNS TABLE (from_daily integer, from_sub integer, from_pack integer)
LANGUAGE plpgsql
AS $function$
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

  from_daily := v_from_daily;
  from_sub   := v_from_sub;
  from_pack  := v_from_pack;
  RETURN NEXT;
END;
$function$;

-- Reverses a deduction. NULL split means the row predates this migration —
-- fall back to the old behaviour and put the lot in pack rather than guess.
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_user_id uuid,
  p_daily   integer,
  p_sub     integer,
  p_pack    integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.users
  SET daily_credits = daily_credits + COALESCE(p_daily, 0),
      sub_credits   = sub_credits   + COALESCE(p_sub, 0),
      pack_credits  = pack_credits  + COALESCE(p_pack, 0),
      updated_at    = now()
  WHERE id = p_user_id;
END;
$function$;
