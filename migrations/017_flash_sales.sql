-- Flash sales for XRGE credit purchases
-- Admins create time-limited discounts on credit packages bought with XRGE

CREATE TABLE IF NOT EXISTS xrge_flash_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  discount_percent INT NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 90),
  bonus_credits_percent INT NOT NULL DEFAULT 0 CHECK (bonus_credits_percent >= 0 AND bonus_credits_percent <= 500),
  packages TEXT[] DEFAULT NULL, -- NULL = all packages, or array of package IDs
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  max_uses INT DEFAULT NULL, -- NULL = unlimited
  uses INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flash_sales_active ON xrge_flash_sales(active, starts_at, ends_at);
