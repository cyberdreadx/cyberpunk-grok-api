-- Asynchronous jobs for the public v1 API.
--
-- The synchronous endpoint (/api/v1/comfy) holds one HTTP connection open for
-- the whole generation and gives up at 280 seconds, after which it refunds.
-- That ceiling is fine for images, which finish in 10-80s, and unusable for
-- video, which regularly needs longer: a measured gltch-wan job was refunded at
-- 282s having never failed. The app does video because it polls out of band.
-- This table lets the API do the same — submit returns a handle immediately,
-- and the caller polls it.
--
-- Credits are taken at submit so queued work is never free, and refunded if the
-- job fails or expires. `status` carries the settlement, which is why
-- 'finalizing' exists as a distinct state: the Neon HTTP driver has no
-- transactions, so a poll claims the row by moving it out of 'running' before
-- it stores output or refunds. Two concurrent polls then cannot both settle.

CREATE TABLE IF NOT EXISTS api_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id    UUID REFERENCES api_keys(id) ON DELETE SET NULL,

  -- what was asked for
  workflow      VARCHAR(32)  NOT NULL,
  kind          VARCHAR(8)   NOT NULL CHECK (kind IN ('image','video')),
  params        JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- the RunPod handle this job is tracking
  rp_endpoint   VARCHAR(64)  NOT NULL,
  rp_job_id     VARCHAR(128) NOT NULL,

  -- lifecycle: running -> finalizing -> completed | failed
  status        VARCHAR(16)  NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','finalizing','completed','failed')),
  credits_held  INT          NOT NULL,
  seed          BIGINT,
  result_url    TEXT,
  error         TEXT,

  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- set once credits are finally kept or returned; the sweep uses it to tell a
  -- settled row from one that merely stopped being polled
  settled_at    TIMESTAMPTZ
);

-- A caller listing their own jobs, newest first.
CREATE INDEX IF NOT EXISTS idx_api_jobs_user ON api_jobs(user_id, created_at DESC);

-- The sweep's query: unsettled rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_api_jobs_open
  ON api_jobs(created_at) WHERE settled_at IS NULL;

-- One row per RunPod job, so a retried submit cannot double-track it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_jobs_rp ON api_jobs(rp_endpoint, rp_job_id);

-- refundCredits() needs the original daily/sub/pack split, not just the total:
-- credits come off daily first, then subscription, then packs, and a refund has
-- to put them back in the same buckets. The synchronous endpoint keeps that
-- breakdown in a local variable because it refunds inside the same request.
-- An async job is refunded by a later request, or by the sweep, so the split
-- has to outlive the submit.
ALTER TABLE api_jobs ADD COLUMN IF NOT EXISTS credits_split JSONB NOT NULL DEFAULT '{}'::jsonb;
