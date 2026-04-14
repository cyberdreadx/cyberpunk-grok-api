-- Add lock fields to feed_posts
-- lock_cost = credits to unlock (0 = free)
-- lock_price_cents = USD price in cents for Stripe unlock (0 = no cash option)
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_cost INT NOT NULL DEFAULT 0;
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_price_cents INT NOT NULL DEFAULT 0;

-- Track which users have unlocked which locked posts
CREATE TABLE IF NOT EXISTS feed_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits_paid INT NOT NULL DEFAULT 0,
  cents_paid INT NOT NULL DEFAULT 0,
  unlock_method TEXT NOT NULL DEFAULT 'credits', -- 'credits' or 'stripe'
  stripe_session_id TEXT,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_unlocks_user ON feed_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_unlocks_post ON feed_unlocks(post_id);
