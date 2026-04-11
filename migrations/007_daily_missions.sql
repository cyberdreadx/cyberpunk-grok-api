-- Daily missions / 7-day check-in system
-- Each user has a single row tracking their current cycle progress.
-- Individual claims are logged per day.

CREATE TABLE IF NOT EXISTS daily_mission_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  streak_day    int NOT NULL DEFAULT 1,          -- current day in 7-day cycle (1-7)
  cycle_start   date NOT NULL DEFAULT CURRENT_DATE,
  last_claim_date date,                          -- last calendar day a claim was made
  streak_bonus_claimed boolean DEFAULT false,    -- has day-7 bonus been claimed this cycle
  total_earned  int NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_mission_claims (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  claim_date date NOT NULL DEFAULT CURRENT_DATE,
  mission    text NOT NULL,  -- 'login', 'generate', 'story', 'reddit', 'share'
  credits    int NOT NULL DEFAULT 10,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, claim_date, mission)
);

CREATE INDEX IF NOT EXISTS idx_dmc_user_date ON daily_mission_claims(user_id, claim_date);
