-- XRGE (ERC-20 on Base) payment orders
-- Run this against your Neon database before enabling the XRGE payment feature.

CREATE TABLE IF NOT EXISTS xrge_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package         TEXT NOT NULL,               -- e.g. 'starter', 'pro', 'mega'
  base_credits    INTEGER NOT NULL,            -- credits before bonus
  bonus_credits   INTEGER NOT NULL DEFAULT 0,  -- 15% bonus credits
  total_credits   INTEGER NOT NULL,            -- base + bonus
  amount_cents    INTEGER NOT NULL DEFAULT 0,  -- USD equivalent
  xrge_amount     TEXT NOT NULL,               -- human-readable XRGE amount (e.g. '523.4000')
  xrge_rate       TEXT NOT NULL,               -- USD rate at time of order (e.g. '0.05')
  deposit_address TEXT NOT NULL,               -- wallet address tokens sent to
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | verified | expired | cancelled
  tx_hash         TEXT,                        -- Base chain transaction hash once verified
  tx_block        INTEGER,                     -- block number of the verified transfer
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_xrge_orders_user   ON xrge_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_xrge_orders_status ON xrge_orders(status);
CREATE INDEX IF NOT EXISTS idx_xrge_orders_txhash ON xrge_orders(tx_hash);
