-- XRGE lock pricing for feed posts and stories
-- Creators set an XRGE amount; buyers pay on-chain, creator gets 80%, platform gets 20%

ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_xrge_amount TEXT DEFAULT NULL;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS lock_xrge_amount TEXT DEFAULT NULL;

-- Creator wallet address on profiles (for display / future direct pay)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address TEXT DEFAULT NULL;

-- Track XRGE-based unlocks
ALTER TABLE feed_unlocks ADD COLUMN IF NOT EXISTS xrge_paid TEXT DEFAULT NULL;
ALTER TABLE feed_unlocks ADD COLUMN IF NOT EXISTS xrge_tx_hash TEXT DEFAULT NULL;

-- story_unlocks may need the same columns
ALTER TABLE story_unlocks ADD COLUMN IF NOT EXISTS xrge_paid TEXT DEFAULT NULL;
ALTER TABLE story_unlocks ADD COLUMN IF NOT EXISTS xrge_tx_hash TEXT DEFAULT NULL;
