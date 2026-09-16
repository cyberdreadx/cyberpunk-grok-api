-- Resend delivery + engagement events, and the addresses we must stop mailing.
--
-- api/resend-webhook.ts existed but was never switched on (no RESEND_WEBHOOK_SECRET),
-- so bounces and spam complaints were never recorded anywhere: every one of the
-- 144k email_log rows says only "sent". Dead addresses kept being mailed and
-- complaints were invisible, both of which quietly cost sending reputation.
--
-- Events land in their own table rather than in email_log.status, because the
-- campaign sender dedupes on `status = 'sent'`: moving a row to 'delivered' or
-- 'clicked' would make an already-mailed recipient look unmailed and send them
-- a second copy.

CREATE TABLE IF NOT EXISTS email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Webhook delivery id. Svix retries until it gets a 2xx, so this is the
  -- idempotency key: a retry of a delivery we already stored is a no-op.
  svix_id text UNIQUE,
  resend_id text,
  recipient text NOT NULL,
  -- Campaign / email type, resolved from email_log by resend_id, so clicks can
  -- be attributed to the campaign that earned them.
  email_type text,
  event text NOT NULL,
  link text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_events_type_event ON email_events (email_type, event);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient ON email_events (lower(recipient));
CREATE INDEX IF NOT EXISTS idx_email_events_created ON email_events (created_at DESC);

-- Addresses that hard-bounced or reported spam. Checked by every campaign query.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The webhook looks rows up by resend_id; email_log had no index on it.
CREATE INDEX IF NOT EXISTS idx_email_log_resend_id ON email_log (resend_id);
