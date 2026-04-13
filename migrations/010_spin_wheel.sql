-- Add last_free_spin column for spin wheel cooldown tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_free_spin timestamptz;
