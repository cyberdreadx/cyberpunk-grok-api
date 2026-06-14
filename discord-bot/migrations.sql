-- Discord bot tables. Run once against the same Neon DB as the main app.
-- Mirrors the telegram_* tables (telegram-bot/) so the bot links Discord users
-- to web accounts and charges their existing web credits.

CREATE TABLE IF NOT EXISTS discord_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id      text UNIQUE NOT NULL,
  username        text,
  linked_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discord_link_codes (
  code              text PRIMARY KEY,
  discord_user_id   uuid NOT NULL REFERENCES discord_users(id) ON DELETE CASCADE,
  used              boolean NOT NULL DEFAULT false,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discord_link_codes_user ON discord_link_codes(discord_user_id);

-- per-user Midjourney-style defaults (aspect/length/sound/quality)
ALTER TABLE discord_users ADD COLUMN IF NOT EXISTS settings jsonb;
