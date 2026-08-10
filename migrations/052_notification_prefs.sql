-- Email notification preferences + send throttle.
--
-- Until now every email the platform sent was transactional (verification, 2FA,
-- receipts) or an admin-triggered campaign. Emailing users about social events
-- (comments, follows, unlocks, DMs) is bulk mail: CAN-SPAM requires a working
-- opt-out, and Gmail/Yahoo bulk-sender rules require one-click unsubscribe
-- (RFC 8058) or the domain's reputation suffers. This is that opt-out.

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Master switch. false = never send a notification email, whatever `types` says.
  email_enabled boolean NOT NULL DEFAULT true,
  -- Sparse per-type overrides, e.g. {"upvote": true, "comment": false}.
  -- Absent keys fall back to DEFAULT_EMAIL_TYPES in api/_lib/notification-prefs.ts,
  -- so changing a default never needs a backfill.
  types         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Flood guard: one row per (user, type), holding the last send time. A burst of
-- 40 comments must not produce 40 emails — that's both a Resend bill and the
-- fastest way to get users to mark the domain as spam.
CREATE TABLE IF NOT EXISTS notification_email_throttle (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);
