-- ============================================================
-- Email Verification: prevent bogus signups
-- Adds verification_code + email_verified to users table
-- ============================================================

-- Add verification columns to users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_code TEXT,
  ADD COLUMN IF NOT EXISTS verification_code_expires_at TIMESTAMPTZ;

-- Index for looking up pending verification codes
CREATE INDEX IF NOT EXISTS idx_users_verification_code
  ON public.users(verification_code)
  WHERE verification_code IS NOT NULL;

-- Mark all EXISTING users as verified (they already signed up)
UPDATE public.users SET email_verified = true WHERE email_verified = false;
