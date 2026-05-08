-- 038_media_errors.sql
-- Lightweight client-side media error log: feed thumbnails / videos failing to load.
-- Used by the admin "Media Errors" dashboard to spot rotated CDN hosts,
-- expired blobs, and codec issues.

CREATE TABLE IF NOT EXISTS media_errors (
  id          BIGSERIAL PRIMARY KEY,
  url         TEXT        NOT NULL,
  host        TEXT        NOT NULL,
  ext         TEXT        NOT NULL,
  kind        TEXT        NOT NULL,                       -- 'image' | 'video'
  source      TEXT        NOT NULL DEFAULT 'feed-card',   -- where it failed
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_errors_created_at ON media_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_errors_host       ON media_errors (host);
CREATE INDEX IF NOT EXISTS idx_media_errors_url        ON media_errors (url);
