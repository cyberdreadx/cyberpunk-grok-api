-- Add optional expiration to user bans (NULL = permanent)
ALTER TABLE user_bans ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;
