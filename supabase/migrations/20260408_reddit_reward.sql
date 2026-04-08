-- Track one-time Reddit subreddit reward (10 free pack credits)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reddit_reward_claimed BOOLEAN NOT NULL DEFAULT false;
