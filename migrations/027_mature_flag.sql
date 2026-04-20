-- Mature content flag for posts and stories.
-- Creators can mark uploads as mature; viewers can blur-by-default in settings.
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS is_mature BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stories    ADD COLUMN IF NOT EXISTS is_mature BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_feed_posts_mature ON feed_posts(is_mature) WHERE is_mature = true;
CREATE INDEX IF NOT EXISTS idx_stories_mature   ON stories(is_mature)    WHERE is_mature = true;
