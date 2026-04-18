-- Creator Verification System
-- Adds Stripe Identity + monthly verification subscription tracking.
-- Hard cutoff: existing users start as 'unverified'. Cash balance accrued
-- BEFORE this migration is grandfathered (still withdrawable).
-- New monetization (priced posts/stories) and new payouts require verification.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_session_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_checkout_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_onetime_paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_renews_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_lapsed_at TIMESTAMPTZ;

-- Constrain values
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT verification_status_check
    CHECK (verification_status IN ('unverified','pending','verified','lapsed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_verification_status ON users(verification_status);
CREATE INDEX IF NOT EXISTS idx_users_verification_session ON users(verification_session_id);
CREATE INDEX IF NOT EXISTS idx_users_verification_sub ON users(verification_subscription_id);
