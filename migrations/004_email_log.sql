-- Email delivery log for tracking verification, password reset, and notification emails
CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient TEXT NOT NULL,
  email_type TEXT NOT NULL,           -- 'verification', 'password_reset', 'daily_credits'
  resend_id TEXT,                     -- Resend message ID for tracking
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'bounced', 'complained'
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_log_recipient ON email_log (recipient);
CREATE INDEX idx_email_log_type ON email_log (email_type);
CREATE INDEX idx_email_log_status ON email_log (status);
CREATE INDEX idx_email_log_created ON email_log (created_at DESC);
