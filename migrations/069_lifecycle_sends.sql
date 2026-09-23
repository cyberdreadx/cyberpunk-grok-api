-- Behaviour-triggered emails: cart recovery, empty tank, win-back.
--
-- Until now the product sent transactional codes and mass blasts, and nothing in
-- between: 142 checkouts were abandoned last month with no follow-up, 398 people
-- sat at zero credits in silence, and 658 past customers went quiet unbothered.
--
-- This table is the memory that keeps those flows honest. One row per (flow,
-- user, ref) makes a send idempotent — a cron that runs every 15 minutes must
-- never mail the same person about the same thing twice — and it is also what
-- the frequency cap and per-flow cooldowns are computed from.
CREATE TABLE IF NOT EXISTS lifecycle_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What the send was about: a Stripe session id for cart recovery, '' for
  -- flows that are about the person rather than a specific thing.
  ref text NOT NULL DEFAULT '',
  email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_once ON lifecycle_sends (flow, user_id, ref);
CREATE INDEX IF NOT EXISTS idx_lifecycle_user_time ON lifecycle_sends (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_flow_time ON lifecycle_sends (flow, sent_at DESC);
