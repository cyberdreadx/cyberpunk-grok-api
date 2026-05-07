-- Creator application funnel for /apply
-- Anyone (logged in or not) can submit; admin reviews from /admin.

CREATE TABLE IF NOT EXISTS creator_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  country TEXT,
  age_confirmed BOOLEAN NOT NULL DEFAULT false,
  socials JSONB NOT NULL DEFAULT '{}'::jsonb,           -- { instagram, x, tiktok, onlyfans, other }
  pitch TEXT NOT NULL,                                  -- vibe / niche / languages
  niche TEXT,
  languages TEXT,
  sample_urls JSONB NOT NULL DEFAULT '[]'::jsonb,       -- array of image urls (R2/blob) — 3-5
  payout_pref TEXT NOT NULL DEFAULT 'stripe',           -- 'stripe' | 'xrge'
  status TEXT NOT NULL DEFAULT 'pending',               -- 'pending' | 'approved' | 'rejected'
  admin_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE creator_applications ADD CONSTRAINT ca_status_check
    CHECK (status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE creator_applications ADD CONSTRAINT ca_payout_check
    CHECK (payout_pref IN ('stripe','xrge'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_creator_apps_status ON creator_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_apps_user ON creator_applications(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_apps_handle_pending
  ON creator_applications(LOWER(handle)) WHERE status = 'pending';

-- Mark approved creators as featured/visible in /creators directory.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_featured_creator BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_featured_creator
  ON users(is_featured_creator) WHERE is_featured_creator = true;
