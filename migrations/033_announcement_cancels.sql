-- Stores a cancel signal for in-flight background announcement campaigns.
-- The send-announcement handler checks this table before sending each batch
-- and aborts the self-continuation loop if a row exists for the campaign.
CREATE TABLE IF NOT EXISTS announcement_cancels (
  campaign TEXT PRIMARY KEY,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
