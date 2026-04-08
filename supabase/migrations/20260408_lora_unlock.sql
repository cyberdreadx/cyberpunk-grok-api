-- Add lora_unlocked flag to users table
-- Unlocked via one-time $30 Stripe payment, grants access to all NSFW LoRAs
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lora_unlocked BOOLEAN NOT NULL DEFAULT false;
