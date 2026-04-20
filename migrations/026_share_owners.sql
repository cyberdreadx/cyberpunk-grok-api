-- Tracks ownership of shareable /s/:id links so the original creator
-- (or an admin) can purge the underlying Vercel Blob + metadata when
-- the source generation is deleted from their Library.
--
-- Legacy shares (created before this table existed) are backfilled by
-- cross-referencing `usage_log` rows of the form `shared:<shareId>`
-- written by api/share.ts POST.

CREATE TABLE IF NOT EXISTS share_owners (
  share_id   TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ext        TEXT NOT NULL DEFAULT 'png',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_owners_user
  ON share_owners(user_id, created_at DESC);

-- Backfill from usage_log: rows look like { mode='share', prompt='shared:<id>' }.
-- We can't recover the file extension from the log, so default to 'png' and let
-- the DELETE handler list-by-prefix to find the actual blob(s).
INSERT INTO share_owners (share_id, user_id, created_at, ext)
SELECT
  substring(prompt FROM 8)         AS share_id,
  user_id,
  MIN(created_at)                  AS created_at,
  'png'                            AS ext
FROM usage_log
WHERE mode = 'share'
  AND prompt LIKE 'shared:%'
  AND length(substring(prompt FROM 8)) BETWEEN 4 AND 16
GROUP BY substring(prompt FROM 8), user_id
ON CONFLICT (share_id) DO NOTHING;
