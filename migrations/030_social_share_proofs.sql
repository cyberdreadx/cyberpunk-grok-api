-- Daily mission proofs: users submit a Reddit/X post URL each day to claim
CREATE TABLE IF NOT EXISTS daily_share_proofs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('reddit', 'twitter')),
  url         text NOT NULL,
  claim_date  date NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, platform, claim_date),
  UNIQUE(url)
);

CREATE INDEX IF NOT EXISTS idx_dsp_user_date ON daily_share_proofs(user_id, claim_date);
