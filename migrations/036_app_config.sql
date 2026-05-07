-- app_config: generic key/value store for runtime app flags & settings.
-- Used by /api/immersion (key='immersion_ui') and /api/admin/free-credits (key='free_credits').
CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
