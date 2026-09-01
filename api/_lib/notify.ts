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
  /** Site path the notification email should link to, e.g. "/feed?post=123". */
  link?: string;
  /** Set true to skip the email even when the user has that type enabled. */
  noEmail?: boolean;
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
    /*
     * `message` is NOT NULL and this INSERT never set it, so every call failed
     * the constraint — and the catch below swallowed it silently. The table
     * held 4 rows dated no later than 2026-03-31: not one comment, DM, like or
     * follow notification had been delivered in five months. `title` is what
     * the UI renders, so it is what `message` carries.
     */
    await sql`
      INSERT INTO notifications (user_id, type, title, body, message, actor_id, actor_username, actor_avatar_url, ref_id)
      VALUES (
        ${params.userId},
        ${params.type},
        ${params.title},
        ${params.body || null},
        ${params.title},
        ${params.actorId || null},
        ${params.actorUsername || null},
        ${params.actorAvatarUrl || null},
        ${params.refId || null}
      )
    `;

    // Email is best-effort and deliberately NOT awaited: this runs on a
    // long-lived Node process (server/index.ts), and callers like follows.ts
    // await notify() inline, so awaiting a Resend round-trip here would add
    // ~300ms to the user's request for something they never see.
    if (!params.noEmail) {
      void maybeEmail(params).catch((e) => console.error("[notify:email]", e));
    }
  } catch (err) {
    console.error("[notify]", err);
  }
}

/** Decide whether this notification also warrants an email, and send it. */
async function maybeEmail(params: NotifyParams): Promise<void> {
  const { getPrefs, claimEmailSlot, DEFAULT_EMAIL_TYPES } = await import("./notification-prefs");

  // Unknown types never email — new notification kinds must opt in explicitly
  // by being added to DEFAULT_EMAIL_TYPES, so nothing starts mailing by accident.
  if (!(params.type in DEFAULT_EMAIL_TYPES)) return;

  const prefs = await getPrefs(params.userId);
  if (!prefs.emailEnabled) return;
  if (!prefs.types[params.type]) return;

  const sql = getDb();
  const [user] = await sql`
    SELECT email, email_verified FROM users WHERE id = ${params.userId}::uuid
  `;
  // Never mail an unverified address — that's how you end up sending to
  // typo'd and spam-trap addresses and burning the sending domain.
  if (!user?.email || !user.email_verified) return;

  // Throttle last, so a blocked send doesn't consume the slot for a later one.
  if (!(await claimEmailSlot(params.userId, params.type))) return;

  const { sendNotificationEmail } = await import("./email");
  await sendNotificationEmail({
    to: user.email,
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    actorUsername: params.actorUsername,
    link: params.link || defaultLink(params),
  });
}

/**
 * Where the email's VIEW button should land, when the caller didn't say.
 *
 * In-app, NotificationBell routes post-type notifications by stashing the id in
 * sessionStorage and navigating to /feed — that can't be expressed in a URL, so
 * email links go to the section rather than the exact post.
 */
function defaultLink(params: NotifyParams): string {
  switch (params.type) {
    case "follow":
      return params.actorUsername ? `/profile/${encodeURIComponent(params.actorUsername)}` : "/feed";
    case "comment":
    case "upvote":
    case "unlock":
      return "/feed";
    case "dm":
      return "/chat";
    default:
      return "/";
  }
}
