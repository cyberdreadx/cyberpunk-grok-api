-- Global key/value config (e.g. master UI immersion tuning for all users).
CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_config IS 'Application-wide configuration; immersion_ui holds master ImmersionSettings JSON.';
