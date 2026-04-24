-- Allow the new `grok_subreddit` platform on daily share proofs.
-- The original CHECK constraint only allowed ('reddit', 'twitter'); add the
-- premium r/grok mission as its own platform so it dedupes independently
-- from the generic reddit mission.
ALTER TABLE daily_share_proofs DROP CONSTRAINT IF EXISTS daily_share_proofs_platform_check;
ALTER TABLE daily_share_proofs
  ADD CONSTRAINT daily_share_proofs_platform_check
  CHECK (platform IN ('reddit', 'grok_subreddit', 'twitter'));
