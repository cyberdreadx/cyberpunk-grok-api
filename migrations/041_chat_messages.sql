-- Persistent chat messages (last 100 per channel kept by app logic)
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  channel     TEXT NOT NULL,
  user_id     UUID NOT NULL,
  username    TEXT NOT NULL,
  text        TEXT NOT NULL,
  ts          BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_ts
  ON chat_messages (channel, ts DESC);
