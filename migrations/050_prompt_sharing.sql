-- Community prompt board: share successful prompts and vote on the best ones.

CREATE TABLE IF NOT EXISTS prompt_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'text-to-image',
  tags TEXT[] NOT NULL DEFAULT '{}',
  example_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prompt_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES prompt_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('👍', '👎')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_posts_created ON prompt_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_posts_user ON prompt_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_votes_post ON prompt_votes(post_id);
