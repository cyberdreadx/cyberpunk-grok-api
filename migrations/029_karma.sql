-- ── Karma system ────────────────────────────────────────────────────────────
-- Allows users to earn posting access through engagement instead of purchase.

ALTER TABLE users ADD COLUMN IF NOT EXISTS karma INTEGER NOT NULL DEFAULT 0;

-- Append-only ledger of every karma change.
-- A unique source key prevents double-awarding for the same action and lets us
-- revert (delete by source) when a vote/comment is removed.
CREATE TABLE IF NOT EXISTS karma_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,           -- e.g. 'upvote_received','comment_post','daily_mission','like_given'
  source_key  TEXT NOT NULL,           -- e.g. 'reaction:<id>', 'comment:<id>', 'mission:2025-04-22:like_post'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_key)
);

CREATE INDEX IF NOT EXISTS idx_karma_events_user_created ON karma_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_karma_events_reason_created ON karma_events(reason, created_at DESC);
