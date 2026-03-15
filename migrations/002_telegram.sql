-- Telegram bot tables: users, jobs, transactions, link codes.
-- Run this against your Neon database before starting the Telegram bot.

CREATE TABLE IF NOT EXISTS telegram_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id     BIGINT UNIQUE NOT NULL,
  username        TEXT,
  first_name      TEXT,
  credits         INTEGER NOT NULL DEFAULT 0,
  linked_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id  UUID NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  chat_id           BIGINT NOT NULL,
  message_id        INTEGER,
  runpod_job_id     TEXT NOT NULL,
  endpoint_id       TEXT NOT NULL,
  job_type          TEXT NOT NULL,             -- 'edit' | 'video'
  output_type       TEXT NOT NULL,             -- 'image' | 'video'
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
  credits_used      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS telegram_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id  UUID NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  credits           INTEGER NOT NULL,
  payment_method    TEXT NOT NULL,             -- 'stars' | 'xrge'
  stars_amount      INTEGER,
  xrge_amount       TEXT,
  tx_hash           TEXT,
  telegram_payment_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id  UUID NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  code              TEXT UNIQUE NOT NULL,
  used              BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_tg_users_telegram_id ON telegram_users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_tg_users_linked      ON telegram_users(linked_user_id);
CREATE INDEX IF NOT EXISTS idx_tg_jobs_status       ON telegram_jobs(status);
CREATE INDEX IF NOT EXISTS idx_tg_jobs_user         ON telegram_jobs(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_tg_txn_user          ON telegram_transactions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_tg_link_code         ON telegram_link_codes(code);
