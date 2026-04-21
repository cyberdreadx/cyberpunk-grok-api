-- Idempotency keys for feed post creation. Lets clients safely retry
-- POST /feed with the same Idempotency-Key header without duplicating
-- the post. Keys expire after 24 hours via cron (or implicit eviction).
CREATE TABLE IF NOT EXISTS feed_idempotency (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_feed_idempotency_created
  ON feed_idempotency(created_at DESC);
