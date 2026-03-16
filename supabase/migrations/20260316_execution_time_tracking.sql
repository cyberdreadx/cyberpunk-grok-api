-- Add execution time tracking to usage_log for RunPod cost calculation
ALTER TABLE public.usage_log ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;
