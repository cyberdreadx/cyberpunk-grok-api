-- Add lock_cost to stories (0 = free, >0 = costs credits to view)
ALTER TABLE stories ADD COLUMN IF NOT EXISTS lock_cost INT NOT NULL DEFAULT 0;

-- Track which users have unlocked which locked stories
CREATE TABLE IF NOT EXISTS story_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits_paid INT NOT NULL DEFAULT 0,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(story_id, user_id)
);

CREATE INDEX idx_story_unlocks_user ON story_unlocks(user_id);
CREATE INDEX idx_story_unlocks_story ON story_unlocks(story_id);
