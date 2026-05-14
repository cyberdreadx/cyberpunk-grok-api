-- 047_stories_active_index.sql
-- Backfills the missing `idx_stories_active` index that migration 006 tried
-- (and failed) to create. The original used a `WHERE expires_at > now()`
-- predicate, which Postgres rejects because `now()` is STABLE, not IMMUTABLE.
-- A plain btree on expires_at is sufficient for the
-- "stories expiring soon / active" queries.
CREATE INDEX IF NOT EXISTS idx_stories_active ON stories(expires_at);
