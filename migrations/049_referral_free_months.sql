-- Referral "free month" reward: when a referred user pays their FIRST sub
-- invoice, the referrer gets a free month applied as a Stripe customer
-- balance credit (negative amount = credit against next invoice). We also
-- bump a counter for the UI ("Free months earned: N").
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS free_months_earned int NOT NULL DEFAULT 0;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS referee_subscribed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referrer_free_month_granted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_sub
  ON referrals(referrer_id) WHERE referrer_free_month_granted = true;
