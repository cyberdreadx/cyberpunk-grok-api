-- Add PayPal capture ID to transactions for idempotency
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS paypal_capture_id TEXT;

-- Unique constraint to prevent duplicate credit for same PayPal capture
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_paypal_capture 
  ON public.transactions (paypal_capture_id) 
  WHERE paypal_capture_id IS NOT NULL;
