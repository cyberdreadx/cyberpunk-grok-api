-- Track cash balance (cents) for creators from Stripe unlocks
ALTER TABLE users ADD COLUMN IF NOT EXISTS cash_balance_cents INT NOT NULL DEFAULT 0;

-- Payout requests table
CREATE TABLE IF NOT EXISTS payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL,
  method TEXT NOT NULL DEFAULT 'paypal', -- 'paypal', 'bank', 'crypto'
  payout_details TEXT NOT NULL DEFAULT '', -- email/address/wallet
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'paid'
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_user ON payout_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);
