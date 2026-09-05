-- 064_wallet_verification.sql
--
-- Wallet binding previously required no proof of ownership: POST /api/v1/xrge-wallet
-- accepted any well-formed 0x address, and PUT /api/profile accepted any string at
-- all. Both feed the holder-tier snapshot, so pasting a public whale address granted
-- real discounts and daily credits.
--
-- This adds the challenge/response plumbing so a bind must be signed by the key that
-- controls the address.

-- When ownership was last proven by signature (NULL = legacy, never proven).
ALTER TABLE users    ADD COLUMN IF NOT EXISTS wallet_verified_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_verified_at TIMESTAMPTZ;

-- One-shot nonces. The exact message text is stored rather than rebuilt at verify
-- time so a later change to the message template can't silently invalidate or, worse,
-- accept a signature over different text than the user was shown.
CREATE TABLE IF NOT EXISTS public.wallet_challenges (
  nonce       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_challenges_user
  ON public.wallet_challenges(user_id, created_at DESC);

-- Supports the opportunistic sweep of expired/among-used rows.
CREATE INDEX IF NOT EXISTS idx_wallet_challenges_expires
  ON public.wallet_challenges(expires_at);

-- Sybil guard that actually covers both tables. The old check only looked at
-- users.wallet_address, so a second account could claim the same address through
-- profiles — which is how 0x2643…a31f ended up on two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address_unique
  ON public.users(lower(wallet_address)) WHERE wallet_address IS NOT NULL;
