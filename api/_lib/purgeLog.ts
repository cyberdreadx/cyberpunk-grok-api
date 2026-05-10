/**
 * purge_log helper — records every media-purge run so admins can audit
 * how much storage was found vs. successfully deleted.
 *
 * Auto-creates the table on first call so deploys without the migration
 * still record entries.
 */
import { getDb } from "./db";

export type PurgeKind = "account-delete" | "admin-orphan-shares" | "library-trash" | string;

export interface PurgeRecord {
  kind: PurgeKind;
  actorUserId?: string | null;
  actorEmail?: string | null;
  targetUserId?: string | null;
  targetEmail?: string | null;
  blobsFound?: number;
  blobsDeleted?: number;
  r2Found?: number;
  r2Deleted?: number;
  errors?: number;
  notes?: Record<string, any> | null;
}

let ensured = false;
async function ensureTable(sql: ReturnType<typeof getDb>): Promise<void> {
  if (ensured) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS purge_log (
        id              BIGSERIAL PRIMARY KEY,
        run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        kind            TEXT NOT NULL,
        actor_user_id   UUID,
        actor_email     TEXT,
        target_user_id  UUID,
        target_email    TEXT,
        blobs_found     INT NOT NULL DEFAULT 0,
        blobs_deleted   INT NOT NULL DEFAULT 0,
        r2_found        INT NOT NULL DEFAULT 0,
        r2_deleted      INT NOT NULL DEFAULT 0,
        errors          INT NOT NULL DEFAULT 0,
        notes           JSONB
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_purge_log_run_at ON purge_log(run_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_purge_log_kind   ON purge_log(kind, run_at DESC)`;
    ensured = true;
  } catch (e: any) {
    console.warn("[purgeLog] ensureTable:", e?.message || e);
  }
}

/** Best-effort insert — never throws (logging must not break the caller). */
export async function recordPurge(rec: PurgeRecord): Promise<void> {
  try {
    const sql = getDb();
    await ensureTable(sql);
    await sql`
      INSERT INTO purge_log (
        kind, actor_user_id, actor_email, target_user_id, target_email,
        blobs_found, blobs_deleted, r2_found, r2_deleted, errors, notes
      ) VALUES (
        ${rec.kind},
        ${rec.actorUserId || null},
        ${rec.actorEmail || null},
        ${rec.targetUserId || null},
        ${rec.targetEmail || null},
        ${rec.blobsFound || 0},
        ${rec.blobsDeleted || 0},
        ${rec.r2Found || 0},
        ${rec.r2Deleted || 0},
        ${rec.errors || 0},
        ${rec.notes ? JSON.stringify(rec.notes) : null}
      )
    `;
  } catch (e: any) {
    console.warn("[purgeLog] insert failed:", e?.message || e);
  }
}
