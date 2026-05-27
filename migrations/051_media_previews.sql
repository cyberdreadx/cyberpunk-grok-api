-- Low-res preview URLs for feed/stories (faster grid + logged-out teasers)
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS preview_image_url TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS preview_url TEXT;

CREATE INDEX IF NOT EXISTS idx_feed_posts_preview ON feed_posts(preview_image_url)
  WHERE preview_image_url IS NOT NULL;
