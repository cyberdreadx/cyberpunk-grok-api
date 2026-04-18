/**
 * Shared helper to create notifications.
 * Fire-and-forget — never throw.
 */
import { getDb } from "./db";

interface NotifyParams {
  userId: string;        // recipient
  type: string;          // 'comment' | 'follow' | 'upvote' | 'unlock' | 'credits' | 'system'
  title: string;
  body?: string;
  actorId?: string;
  actorUsername?: string;
  actorAvatarUrl?: string | null;
  refId?: string;
}

let ensured = false;
async function ensureTable(sql: any) {
  if (ensured) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type text NOT NULL,
        title text NOT NULL,
        body text,
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        actor_username text,
        actor_avatar_url text,
        ref_id text,
        read boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = false`;
    ensured = true;
  } catch (e) {
    console.error("[notify] ensureTable failed", e);
  }
}

export async function notify(params: NotifyParams): Promise<void> {
  try {
    // Don't notify yourself
    if (params.actorId && params.userId === params.actorId) return;

    const sql = getDb();
    await ensureTable(sql);
    await sql`
      INSERT INTO notifications (user_id, type, title, body, actor_id, actor_username, actor_avatar_url, ref_id)
      VALUES (
        ${params.userId},
        ${params.type},
        ${params.title},
        ${params.body || null},
        ${params.actorId || null},
        ${params.actorUsername || null},
        ${params.actorAvatarUrl || null},
        ${params.refId || null}
      )
    `;
  } catch (err) {
    console.error("[notify]", err);
  }
}
