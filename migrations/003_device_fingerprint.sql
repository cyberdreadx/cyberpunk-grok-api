-- Add device_fingerprint column to users table for per-device account limiting.
-- Indexed for fast count queries during signup.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_users_device_fingerprint
  ON users (device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;
