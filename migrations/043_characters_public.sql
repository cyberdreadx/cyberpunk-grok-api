-- Allow users to publish their characters so others can chat with them.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_characters_public ON characters (is_public, published_at DESC) WHERE is_public = true;
