-- API keys for public developer access
CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL DEFAULT 'Default',
  -- Store only the hash; the raw key is shown once at creation
  key_hash    VARCHAR(128) NOT NULL UNIQUE,
  -- First 8 chars for display: "gltch_sk_a1b2c3d4..."
  key_prefix  VARCHAR(20) NOT NULL,
  -- Per-key rate limit (requests per minute)
  rate_limit  INT NOT NULL DEFAULT 30,
  -- Usage tracking
  total_requests BIGINT NOT NULL DEFAULT 0,
  total_credits  BIGINT NOT NULL DEFAULT 0,
  last_used_at   TIMESTAMPTZ,
  -- Lifecycle
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Usage log per API request
CREATE TABLE IF NOT EXISTS api_usage_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  action      VARCHAR(50) NOT NULL,
  credits_used INT NOT NULL DEFAULT 0,
  status      VARCHAR(20) NOT NULL DEFAULT 'success',
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_usage_key ON api_usage_log(api_key_id);
CREATE INDEX idx_api_usage_user ON api_usage_log(user_id, created_at);
