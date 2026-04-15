-- User ban system — presence in this table = banned
CREATE TABLE IF NOT EXISTS user_bans (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'Violation of community guidelines',
  banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
