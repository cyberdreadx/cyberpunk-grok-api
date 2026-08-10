-- Direct messages + user-to-user blocking.
--
-- Design notes:
--
-- * A thread is keyed by the ORDERED pair (user_a < user_b), so a conversation
--   maps to exactly one row no matter who opens it first. The CHECK enforces
--   the ordering; callers must sort before inserting.
--
-- * Unread counts are DENORMALISED onto the thread. "Do I have unread DMs?"
--   is then two indexed SUMs, not a COUNT over every message a user has ever
--   received — that matters because the badge is polled and messages are not
--   pruned.
--
-- * Deliberately NO retention/prune job. api/chat.ts trims each channel to 100
--   messages on every insert; copying that here would mean a DELETE per DM
--   across thousands of threads, and the write amplification costs far more
--   than the storage it saves. Text is ~250 bytes a row.

CREATE TABLE IF NOT EXISTS dm_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message    text,
  last_sender_id  uuid,
  unread_a        integer NOT NULL DEFAULT 0,
  unread_b        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_threads_pair_order CHECK (user_a < user_b),
  CONSTRAINT dm_threads_pair_uniq  UNIQUE (user_a, user_b)
);

-- One index per side: the badge query sums each side separately so both can
-- use an index. A single OR'd predicate across both columns could not.
CREATE INDEX IF NOT EXISTS idx_dm_threads_a ON dm_threads (user_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_threads_b ON dm_threads (user_b, last_message_at DESC);

CREATE TABLE IF NOT EXISTS dm_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages (thread_id, created_at DESC);

-- User-to-user blocking. Nothing like this existed anywhere in the codebase
-- before DMs; opening a private channel on an adult platform with paid
-- creators without one is the single biggest risk in the feature.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- Reverse lookup: "is the person I'm messaging blocking me?"
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_id);
