-- ============================================================
-- Security hardening: brute force protection, rate limiting,
-- webhook idempotency
-- ============================================================

-- 1. Verification attempt counter on users table
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0;

-- 2. Rate limiting table — tracks request counts per key (IP or email)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, endpoint)
);

-- Auto-cleanup old rate limit entries (older than 1 hour)
CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON public.rate_limits(window_start);

-- 3. Webhook idempotency table — track processed Stripe event IDs
CREATE TABLE IF NOT EXISTS public.processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup old processed events (older than 7 days)
CREATE INDEX IF NOT EXISTS idx_processed_events_at
  ON public.processed_events(processed_at);

-- 4. Unique index on transactions.stripe_session_id for extra safety
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_stripe_session_unique
  ON public.transactions(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
