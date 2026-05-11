-- One-time credit claims (e.g., follow-on-X bonus). Unique per (user, key).
CREATE TABLE IF NOT EXISTS one_time_claims (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  claim_key   text NOT NULL,
  credits     integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, claim_key)
);

CREATE INDEX IF NOT EXISTS idx_otc_user ON one_time_claims(user_id);
