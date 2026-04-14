-- Feed moderators: users who can delete any feed post
CREATE TABLE IF NOT EXISTS feed_moderators (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
