-- 039_support_requests.sql
-- Audit log for in-app preset support-bot requests.

CREATE TABLE IF NOT EXISTS support_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username      TEXT,
  issue_code    TEXT NOT NULL,
  resolution    TEXT,
  credits_refunded INT NOT NULL DEFAULT 0,
  details_json  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_requests_user ON support_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_code ON support_requests(issue_code, created_at DESC);
