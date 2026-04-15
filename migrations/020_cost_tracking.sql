-- Track actual API cost per generation for profit margin analysis
ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS api_cost_cents NUMERIC(10,2) DEFAULT NULL;
