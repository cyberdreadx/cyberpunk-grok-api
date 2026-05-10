-- Records every media-purge run (account deletion, admin orphan sweep,
-- library trash purge) so admins can audit how much was found vs. deleted.
CREATE TABLE IF NOT EXISTS purge_log (
  id              BIGSERIAL PRIMARY KEY,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'account-delete' | 'admin-orphan-shares' | 'library-trash' | other
  kind            TEXT NOT NULL,
  -- The admin/user who triggered the run (NULL for system/cron).
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email     TEXT,
  -- The user whose data was purged (account deletes / library trash).
  -- NULL for bucket-wide sweeps like admin-orphan-shares.
  target_user_id  UUID,
  target_email    TEXT,
  blobs_found     INT NOT NULL DEFAULT 0,
  blobs_deleted   INT NOT NULL DEFAULT 0,
  r2_found        INT NOT NULL DEFAULT 0,
  r2_deleted      INT NOT NULL DEFAULT 0,
  errors          INT NOT NULL DEFAULT 0,
  notes           JSONB
);

CREATE INDEX IF NOT EXISTS idx_purge_log_run_at ON purge_log(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_purge_log_kind   ON purge_log(kind, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_purge_log_target ON purge_log(target_user_id, run_at DESC);
