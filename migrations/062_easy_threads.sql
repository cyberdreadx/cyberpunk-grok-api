-- Chat history for Easy mode.
--
-- Until now an Easy thread lived in React state and died on reload. The images
-- survived (they go to the Library like every other render) but the
-- conversation around them did not, which is the thing that makes a chat UI
-- feel like a chat UI.
--
-- Two tables, both owned by a user and cascading on account deletion. Assets
-- are stored as the URLs the render already has — nothing is duplicated into
-- the database, and no base64 ever lands here.

CREATE TABLE IF NOT EXISTS easy_threads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS easy_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES easy_threads(id) ON DELETE CASCADE,
  -- Denormalised so every read can filter on the owner without joining, and so
  -- a bug in thread scoping cannot leak another account's messages.
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'result')),
  text       text,
  -- result rows only
  status     text CHECK (status IS NULL OR status IN ('running', 'done', 'error')),
  error      text,
  -- [{ url, previewUrl, type }] — the same URLs the Library holds.
  assets     jsonb NOT NULL DEFAULT '[]'::jsonb,
  label      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The thread list is "my threads, most recently touched first".
CREATE INDEX IF NOT EXISTS easy_threads_user_updated
  ON easy_threads (user_id, updated_at DESC);

-- Reading one thread is "its messages, oldest first".
CREATE INDEX IF NOT EXISTS easy_messages_thread_created
  ON easy_messages (thread_id, created_at);
