-- Character emotional memory: mood state, long-term memory, and relationship context
ALTER TABLE characters ADD COLUMN IF NOT EXISTS mood TEXT DEFAULT 'neutral';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS memory_summary TEXT DEFAULT '';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS relationship_notes TEXT DEFAULT '';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS mood_updated_at TIMESTAMPTZ DEFAULT now();
