-- Community credit pot: a single shared pool users can claim from daily
-- and donate to from their own balance.

CREATE TABLE IF NOT EXISTS community_pot (
  id INT PRIMARY KEY DEFAULT 1,
  balance INT NOT NULL DEFAULT 0,
  total_donated BIGINT NOT NULL DEFAULT 0,
  total_claimed BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT community_pot_singleton CHECK (id = 1)
);

INSERT INTO community_pot (id, balance) VALUES (1, 0) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pot_donations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  amount INT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pot_donations_user ON pot_donations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pot_donations_created ON pot_donations (created_at DESC);

CREATE TABLE IF NOT EXISTS pot_claims (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  amount INT NOT NULL CHECK (amount > 0),
  claim_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, claim_date)
);
CREATE INDEX IF NOT EXISTS idx_pot_claims_date ON pot_claims (claim_date DESC);
