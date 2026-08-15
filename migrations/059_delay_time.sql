-- 059: record RunPod's delayTime (queue + cold start) alongside execution time.
--
-- We already store execution_time_ms, which is GPU work only, and derive
-- api_cost_cents from it. That makes cold starts structurally invisible: the
-- edit endpoint sits at idleTimeout=5s and the median gap between requests is
-- 26s, so most users wait through a worker boot that nothing measures and
-- nothing bills to a job.
--
-- delayTime is already in the RunPod poll response (comfyui.ts) and thrown
-- away. Storing it turns "cold starts feel like 40-60s" into a distribution we
-- can set idleTimeout against and verify afterwards.
--
-- Nullable with no default: NULL means "not captured" (every historical row,
-- and any path that doesn't poll RunPod), which must stay distinguishable from
-- a genuine 0ms warm start.

ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS delay_time_ms INT;

-- Partial index: the analytics question is always "how bad are the slow ones",
-- so only rows that actually recorded a delay are worth indexing.
CREATE INDEX IF NOT EXISTS idx_usage_log_delay
  ON usage_log(created_at DESC, delay_time_ms)
  WHERE delay_time_ms IS NOT NULL;
