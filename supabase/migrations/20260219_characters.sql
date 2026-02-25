-- Characters table for AI companion chat mode
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  portrait_url TEXT,
  personality TEXT NOT NULL,
  traits JSONB DEFAULT '[]',
  system_prompt TEXT,
  voice_style TEXT DEFAULT 'default',
  llm_backend TEXT DEFAULT 'grok',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
