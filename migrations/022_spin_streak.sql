-- Track consecutive daily spin streaks
ALTER TABLE users ADD COLUMN IF NOT EXISTS spin_streak int NOT NULL DEFAULT 0;
