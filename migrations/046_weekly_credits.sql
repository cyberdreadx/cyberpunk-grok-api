-- Weekly free-credit claim timestamp (for /api/weekly-bonus).
-- 10 credits per 7-day rolling window, available to all authenticated users.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS weekly_credits_claimed_at timestamptz;
