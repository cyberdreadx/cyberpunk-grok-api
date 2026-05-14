-- Official creator persona for optional fan-facing AI chat (linked Characters row).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS official_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creator_persona_chat_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS creator_persona_chat_free_utc_date DATE,
  ADD COLUMN IF NOT EXISTS creator_persona_chat_free_used INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_official_character ON users(official_character_id)
  WHERE official_character_id IS NOT NULL;
