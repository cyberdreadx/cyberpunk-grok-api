-- Anti-farm promo: free credits for one approved AntiReddit post.
--
-- 20 payouts, one per GLTCH account, ever. Every rule that must hold is a
-- database constraint rather than an application check — the discount bug this
-- codebase already lived through came from trusting app-side logic that a
-- concurrent request could step around. Two people submitting at once, or one
-- person double-clicking approve, must fail on the index, not on a race.
--
-- Deliberately NOT stored: no phone, no government id, no wallet address, no
-- AntiReddit username. The AntiReddit account is evidence, not identity — the
-- credits land on the GLTCH user id and nothing else is retained.

CREATE TABLE IF NOT EXISTS promo_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 of the plaintext. The plaintext is printed once at generation and
  -- never stored, so a database leak does not hand out 20 free payouts.
  code_hash  text NOT NULL UNIQUE,
  label      text,
  used_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_url       text NOT NULL,
  -- Lowercased, query/fragment/trailing-slash stripped. Two people cannot
  -- claim the same post, and one person cannot claim it twice with ?utm= on
  -- the end.
  post_url_norm  text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  credits_awarded int NOT NULL DEFAULT 0,
  reject_reason  text,
  code_id        uuid REFERENCES promo_codes(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  decided_by     text
);

-- Rule 3: one payout per GLTCH user id, ever. This is the whole promo in one
-- line — an approve that would be a second payout fails here.
CREATE UNIQUE INDEX IF NOT EXISTS promo_claims_one_approved_per_user
  ON promo_claims (user_id) WHERE status = 'approved';

-- One open claim at a time, so the review queue cannot be flooded by one
-- account. Rejected claims do not block a corrected resubmission.
CREATE UNIQUE INDEX IF NOT EXISTS promo_claims_one_pending_per_user
  ON promo_claims (user_id) WHERE status = 'pending';

-- Rule 6: the same post cannot be claimed twice, by anyone.
CREATE UNIQUE INDEX IF NOT EXISTS promo_claims_unique_post
  ON promo_claims (post_url_norm) WHERE status <> 'rejected';

CREATE INDEX IF NOT EXISTS promo_claims_status_created
  ON promo_claims (status, created_at DESC);

-- Config lives in app_config like the other switches (see api/_lib/promo.ts
-- for defaults) so the cap and credit amount are changeable without a deploy.
INSERT INTO app_config (key, value, updated_at)
VALUES (
  'antifarm_promo',
  '{"enabled": true, "maxApproved": 20, "creditAmount": 25,
    "minAccountAgeDays": 7, "minRenders": 3, "requireCode": true}'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;
