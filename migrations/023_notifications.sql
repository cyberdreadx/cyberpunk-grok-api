-- Notifications system
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,           -- 'comment', 'follow', 'upvote', 'unlock', 'credits', 'system'
  title text NOT NULL,
  body text,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_username text,
  actor_avatar_url text,
  ref_id text,                  -- post id, comment id, etc.
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = false;
