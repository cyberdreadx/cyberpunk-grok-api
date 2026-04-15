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

export async function notify(params: NotifyParams): Promise<void> {
  try {
    // Don't notify yourself
    if (params.actorId && params.userId === params.actorId) return;

    const sql = getDb();
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
