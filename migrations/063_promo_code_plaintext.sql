-- Keep the promo codes readable in the admin panel.
--
-- They were stored as sha256 only, so the plaintext existed exactly once — in
-- the terminal output at generation time. That protected 20 codes worth 25
-- credits each against a database leak, but every payout already requires
-- manual approval, so the code is a distribution mechanism rather than a
-- secret. The trade was wrong: it made the promo unrunnable without keeping a
-- copy somewhere outside the product.
--
-- code_hash stays and remains what the claim path matches on, so the lookup is
-- unchanged and existing rows keep working.

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS code text;

-- Not unique: code_hash already carries the uniqueness constraint, and adding
-- a second one would only create a way for a backfill to fail halfway.
CREATE INDEX IF NOT EXISTS promo_codes_code ON promo_codes (code) WHERE code IS NOT NULL;
