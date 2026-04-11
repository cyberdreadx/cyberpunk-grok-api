-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  avatar_url TEXT,
  bio TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_username ON profiles(username);

-- Posts (live feed)
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_user ON posts(user_id);

-- Reactions
CREATE TABLE IF NOT EXISTS reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL DEFAULT '❤️',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id, emoji)
);

CREATE INDEX idx_reactions_post ON reactions(post_id);

-- Comments (threaded)
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id, created_at);

-- Follows
CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX idx_follows_following ON follows(following_id);

-- Auto-create profile on user signup (if not exists)
CREATE OR REPLACE FUNCTION auto_create_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (user_id, username)
  VALUES (NEW.id, 'user_' || substr(NEW.id::text, 1, 8))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_profile ON users;
CREATE TRIGGER trg_auto_profile
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION auto_create_profile();
