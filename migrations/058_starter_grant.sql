-- 058: one-time starter credit grant, keyed on device rather than account.
--
-- New users currently land with zero credits and no way to earn any before
-- paying: since the earn-only switch, ~1% of verified signups ever generate
-- anything, down from ~90%. The grant exists so someone can see the product
-- work once before they hit the paywall.
--
-- Keyed on device_fingerprint, NOT user_id. Per-account it would be free GPU
-- for anyone willing to register twice — and 268 of the last 565 verified
-- signups came from a device that already had an account. Per-device a farmer
-- gets the grant once, total.
--
-- user_id is ON DELETE SET NULL on purpose. CASCADE would delete this row when
-- an account is removed, releasing the fingerprint and handing back a fresh
-- grant to anyone who deletes and re-registers — which is the exact loop this
-- is meant to close. The claim has to outlive the account.

CREATE TABLE IF NOT EXISTS starter_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  -- NULL fingerprints don't collide in Postgres, so an account with no
  -- fingerprint falls back to the per-user UNIQUE above. Coverage is currently
  -- 100%, so that path is a formality rather than a hole.
  fingerprint TEXT UNIQUE,
  credits     INT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_starter_grants_granted ON starter_grants(granted_at DESC);
