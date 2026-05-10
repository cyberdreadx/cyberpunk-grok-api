-- Mute/ban a user from a single chat channel (or '*' for all channels)
CREATE TABLE IF NOT EXISTS chat_bans (
  user_id     UUID NOT NULL,
  channel     TEXT NOT NULL,
  reason      TEXT,
  until_ts    BIGINT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_chat_bans_until ON chat_bans (until_ts);
