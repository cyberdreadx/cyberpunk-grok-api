-- Expiring credits, without a fourth balance column.
--
-- Every grant on the platform — purchases, mission rewards, spin prizes,
-- referral bonuses, refunds, creator earnings — poured into pack_credits, which
-- never expires. 378,312 credits were outstanding across 17,352 accounts when
-- this was written, with nothing to tell a credit someone paid for from one
-- they farmed.
--
-- A new bucket column was rejected: 56 places across 21 files sum
-- daily + sub + pack to show or gate a balance, and missing one would tell a
-- user holding only promo credits that they were broke. Instead an expiring
-- grant still adds to pack_credits — so every balance read stays correct and
-- untouched — and ALSO records a lot here saying how much of it expires, and
-- when.
--
-- Spending is tracked by a trigger, not by the spend paths: there are nine of
-- them (two SQL functions, the v1 CTE, direct UPDATEs in feed, stories, spin,
-- community pot and two clawbacks), and any future one would silently skip the
-- bookkeeping. Whenever pack_credits goes down, by any route, the trigger draws
-- that amount from the user's live lots, soonest-expiring first — the order
-- that loses the user the least.
--
-- Nothing here is retroactive. Every credit held before this migration has no
-- lot, and a credit with no lot never expires.

CREATE TABLE IF NOT EXISTS credit_lots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(16) NOT NULL CHECK (kind IN ('promo','paid')),
  source      VARCHAR(48) NOT NULL,
  amount      INT NOT NULL CHECK (amount > 0),
  remaining   INT NOT NULL CHECK (remaining >= 0),
  expires_at  TIMESTAMPTZ NOT NULL,
  expired_amount INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The trigger's and the sweep's query: a user's live lots, soonest first.
CREATE INDEX IF NOT EXISTS idx_credit_lots_live
  ON credit_lots(user_id, expires_at) WHERE remaining > 0;
CREATE INDEX IF NOT EXISTS idx_credit_lots_due
  ON credit_lots(expires_at) WHERE remaining > 0;

-- Grant credits that expire. Adds to pack_credits exactly as add_pack_credits
-- does, plus the lot.
CREATE OR REPLACE FUNCTION add_expiring_credits(
  p_user_id UUID, p_amount INT, p_kind TEXT, p_source TEXT, p_days INT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
  UPDATE users SET pack_credits = pack_credits + p_amount, updated_at = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;
  -- p_days <= 0 means expiry is switched off: a normal, permanent grant.
  IF p_days IS NULL OR p_days <= 0 THEN RETURN; END IF;
  INSERT INTO credit_lots (user_id, kind, source, amount, remaining, expires_at)
  VALUES (p_user_id, p_kind, p_source, p_amount, p_amount, now() + make_interval(days => p_days));
END $$;

-- Draw spending down from live lots.
CREATE OR REPLACE FUNCTION consume_credit_lots() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_owed INT := OLD.pack_credits - NEW.pack_credits;
  r RECORD;
  v_take INT;
BEGIN
  -- The expiry sweep lowers pack_credits itself after zeroing the lot; drawing
  -- that same amount from other lots would expire it twice.
  IF current_setting('app.skip_lot_trigger', true) = 'on' THEN RETURN NEW; END IF;
  BEGIN
    FOR r IN
      SELECT id, remaining FROM credit_lots
      WHERE user_id = NEW.id AND remaining > 0 AND expires_at > now()
      ORDER BY expires_at, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_owed <= 0;
      v_take := LEAST(r.remaining, v_owed);
      UPDATE credit_lots SET remaining = remaining - v_take WHERE id = r.id;
      v_owed := v_owed - v_take;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Lots are bookkeeping. A fault here must never block someone spending
    -- credits they hold, so it is reported and swallowed, never raised.
    RAISE WARNING 'consume_credit_lots failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_consume_credit_lots ON users;
CREATE TRIGGER trg_consume_credit_lots
  AFTER UPDATE OF pack_credits ON users
  FOR EACH ROW
  WHEN (NEW.pack_credits < OLD.pack_credits)
  EXECUTE FUNCTION consume_credit_lots();

-- Retire what is left in expired lots. Runs as one statement, so the skip flag
-- set with is_local=true covers exactly this call and nothing else.
CREATE OR REPLACE FUNCTION expire_credit_lots(p_limit INT DEFAULT 5000)
RETURNS TABLE(lots INT, credits INT, users INT) LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_take INT;
  v_lots INT := 0; v_credits INT := 0;
  v_users UUID[] := '{}';
BEGIN
  PERFORM set_config('app.skip_lot_trigger', 'on', true);
  FOR r IN
    SELECT l.id, l.user_id, l.remaining, l.kind, l.source
    FROM credit_lots l
    WHERE l.remaining > 0 AND l.expires_at <= now()
    ORDER BY l.expires_at
    LIMIT p_limit
    FOR UPDATE
  LOOP
    -- Clamp to the balance: never drive an account negative over bookkeeping.
    SELECT LEAST(r.remaining, GREATEST(pack_credits, 0)) INTO v_take
    FROM users WHERE id = r.user_id FOR UPDATE;
    v_take := COALESCE(v_take, 0);

    UPDATE credit_lots SET remaining = 0, expired_amount = v_take WHERE id = r.id;
    IF v_take > 0 THEN
      UPDATE users SET pack_credits = pack_credits - v_take, updated_at = now()
      WHERE id = r.user_id;
      INSERT INTO credit_ledger (user_id, amount, source, ref_key)
      VALUES (r.user_id, -v_take, 'credits_expired', r.kind || ':' || r.source || ':' || r.id);
      v_credits := v_credits + v_take;
      IF NOT r.user_id = ANY(v_users) THEN v_users := v_users || r.user_id; END IF;
    END IF;
    v_lots := v_lots + 1;
  END LOOP;
  PERFORM set_config('app.skip_lot_trigger', 'off', true);
  lots := v_lots; credits := v_credits; users := COALESCE(array_length(v_users, 1), 0);
  RETURN NEXT;
END $$;
