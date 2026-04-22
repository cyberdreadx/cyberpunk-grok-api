/**
 * Karma system — earn posting access through engagement.
 *
 * Awards are append-only via `karma_events` keyed on a unique `source_key`,
 * so re-runs are idempotent and undo (delete by source) is trivial.
 */

export const KARMA_THRESHOLD = 200;
export const KARMA_MIN_ACCOUNT_AGE_HOURS = 48;

export const KARMA_AWARDS = {
  upvote_received: 5,        // someone upvoted your post
  comment_received: 2,       // someone commented on your post
  story_like_received: 1,    // someone liked your story
  comment_post: 1,           // you posted a comment (capped/day)
  like_given: 1,             // you gave a reaction (capped/day)
  daily_mission: 3,          // each completed daily mission
  streak_bonus: 25,          // 7-day streak completion
} as const;

export type KarmaReason = keyof typeof KARMA_AWARDS;

// Daily caps prevent burst-farming of low-quality actions.
const DAILY_CAPS: Partial<Record<KarmaReason, number>> = {
  comment_post: 10,    // max +10 karma/day from your own comments
  like_given: 5,       // max +5 karma/day from giving likes
};

let schemaEnsured = false;
async function ensureSchema(sql: any): Promise<void> {
  if (schemaEnsured) return;
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS karma INTEGER NOT NULL DEFAULT 0`;
    await sql`
      CREATE TABLE IF NOT EXISTS karma_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta       INTEGER NOT NULL,
        reason      TEXT NOT NULL,
        source_key  TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (source_key)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_karma_events_user_created ON karma_events(user_id, created_at DESC)`;
    schemaEnsured = true;
  } catch (err: any) {
    console.error("[karma] ensureSchema:", err.message);
  }
}

/**
 * Award karma idempotently. Returns true if awarded, false if already awarded
 * (duplicate source_key) or daily cap reached.
 */
export async function awardKarma(
  sql: any,
  userId: string,
  reason: KarmaReason,
  sourceKey: string,
): Promise<boolean> {
  if (!userId) return false;
  const delta = KARMA_AWARDS[reason];
  if (!delta) return false;

  // Daily cap check
  const cap = DAILY_CAPS[reason];
  if (cap !== undefined) {
    try {
      const [{ total }] = await sql`
        SELECT COALESCE(SUM(delta), 0)::int AS total
        FROM karma_events
        WHERE user_id = ${userId}::uuid
          AND reason = ${reason}
          AND created_at >= date_trunc('day', now())
      `;
      if (total >= cap) return false;
    } catch {
      // If query fails (e.g. table missing), fall through and try insert.
    }
  }

  try {
    const inserted = await sql`
      INSERT INTO karma_events (user_id, delta, reason, source_key)
      VALUES (${userId}::uuid, ${delta}, ${reason}, ${sourceKey})
      ON CONFLICT (source_key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) return false;
    await sql`UPDATE users SET karma = COALESCE(karma, 0) + ${delta} WHERE id = ${userId}::uuid`;
    return true;
  } catch (err: any) {
    console.error("[karma] award failed:", err.message);
    return false;
  }
}

/**
 * Revert a previously-awarded karma event by source_key.
 * Used when a vote is undone, a comment deleted, or a post removed.
 */
export async function revertKarma(sql: any, sourceKey: string): Promise<void> {
  try {
    const rows = await sql`
      DELETE FROM karma_events WHERE source_key = ${sourceKey}
      RETURNING user_id, delta
    `;
    for (const r of rows) {
      await sql`UPDATE users SET karma = GREATEST(0, COALESCE(karma, 0) - ${r.delta}) WHERE id = ${r.user_id}::uuid`;
    }
  } catch (err: any) {
    console.error("[karma] revert failed:", err.message);
  }
}

/**
 * Posting eligibility via karma path. Caller still checks purchase path.
 * Requires: enough karma + verified email + min account age.
 */
export async function hasKarmaUnlock(sql: any, userId: string): Promise<{
  ok: boolean;
  karma: number;
  threshold: number;
  emailVerified: boolean;
  accountAgeHours: number;
  minAccountAgeHours: number;
}> {
  try {
    const [row] = await sql`
      SELECT
        COALESCE(karma, 0)::int AS karma,
        email_verified,
        EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0 AS age_hours
      FROM users
      WHERE id = ${userId}::uuid
    `;
    const karma = row?.karma ?? 0;
    const emailVerified = !!row?.email_verified;
    const ageHours = Number(row?.age_hours ?? 0);
    const ok =
      karma >= KARMA_THRESHOLD &&
      emailVerified &&
      ageHours >= KARMA_MIN_ACCOUNT_AGE_HOURS;
    return {
      ok,
      karma,
      threshold: KARMA_THRESHOLD,
      emailVerified,
      accountAgeHours: ageHours,
      minAccountAgeHours: KARMA_MIN_ACCOUNT_AGE_HOURS,
    };
  } catch {
    return {
      ok: false,
      karma: 0,
      threshold: KARMA_THRESHOLD,
      emailVerified: false,
      accountAgeHours: 0,
      minAccountAgeHours: KARMA_MIN_ACCOUNT_AGE_HOURS,
    };
  }
}
