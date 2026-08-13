-- 057: Ambassador program.
--
-- A revenue-share tier sitting ON TOP of the existing referral system, not
-- replacing it. Everyone keeps the credit-based referral rewards; ambassadors
-- are an approved subset who additionally earn a cash percentage of what their
-- referred customers actually pay, withdrawable through the payout rails that
-- already exist (Stripe Connect / XRGE / PayPal -> users.cash_balance_cents).
--
-- Why approval-gated: the open referral system is already being farmed. Four
-- accounts have brought ~1,800 signups between them and zero sales. Paying
-- cash on *signups* would industrialise that overnight, so commission accrues
-- only against settled payments, sits in a hold period, and is clawed back on
-- refund or dispute.
--
-- FK note: financial rows use ON DELETE SET NULL, never CASCADE. The
-- transactions/usage_log tables use CASCADE and that is why ~19% of Stripe
-- revenue has no ledger row today — deleting an account erased its payment
-- history. Commission records must outlive both the customer and the
-- ambassador, so they keep the money and drop the person.

-- ── Ambassadors ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ambassadors (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  code               TEXT NOT NULL UNIQUE,
  display_name       TEXT,
  status             TEXT NOT NULL DEFAULT 'active',   -- active | paused | revoked
  -- Terms are per-ambassador so a headline rate change never silently rewrites
  -- a deal someone already signed up under.
  commission_pct     NUMERIC(5,2) NOT NULL DEFAULT 20.00,
  commission_months  INT NOT NULL DEFAULT 12,          -- 0 = no expiry (lifetime)
  hold_days          INT NOT NULL DEFAULT 30,          -- clears most of the dispute window
  tier               TEXT NOT NULL DEFAULT 'standard',
  lifetime_gross_cents      BIGINT NOT NULL DEFAULT 0, -- customer spend attributed
  lifetime_commission_cents BIGINT NOT NULL DEFAULT 0, -- earned, incl. still-pending
  approved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  status_changed_at  TIMESTAMPTZ,
  admin_notes        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ambassadors_status_chk CHECK (status IN ('active','paused','revoked')),
  CONSTRAINT ambassadors_pct_chk    CHECK (commission_pct >= 0 AND commission_pct <= 100)
);

CREATE INDEX IF NOT EXISTS idx_ambassadors_user   ON ambassadors(user_id);
CREATE INDEX IF NOT EXISTS idx_ambassadors_status ON ambassadors(status);
-- Codes are matched case-insensitively at signup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ambassadors_code_lower ON ambassadors(LOWER(code));

-- ── Applications ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ambassador_applications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  requested_code TEXT,
  display_name   TEXT,
  country        TEXT,
  socials        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { platform: url }
  audience_size  INT,
  channels       TEXT,                                  -- how they plan to promote
  pitch          TEXT NOT NULL DEFAULT '',
  payout_pref    TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
  admin_notes    TEXT,
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT amb_app_status_chk CHECK (status IN ('pending','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_amb_app_status ON ambassador_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amb_app_user   ON ambassador_applications(user_id, created_at DESC);
-- One open application at a time per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_amb_app_one_pending
  ON ambassador_applications(user_id) WHERE status = 'pending';

-- ── Attribution ────────────────────────────────────────────────────────
-- One ambassador per customer, first touch wins. commission_until is a real
-- date rather than a computed window so review-and-extend is a single UPDATE
-- and the history of extensions is visible.
CREATE TABLE IF NOT EXISTS ambassador_referrals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_id       UUID NOT NULL REFERENCES ambassadors(id) ON DELETE CASCADE,
  user_id             UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  attributed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  commission_until    TIMESTAMPTZ,                     -- NULL = never expires
  extended_count      INT NOT NULL DEFAULT 0,
  extended_at         TIMESTAMPTZ,
  first_paid_at       TIMESTAMPTZ,
  gross_cents         BIGINT NOT NULL DEFAULT 0,
  commission_cents    BIGINT NOT NULL DEFAULT 0,
  -- Fraud: set when the customer looks like the ambassador's own alt. Blocks
  -- accrual without deleting the attribution, so the pattern stays auditable.
  disqualified        BOOLEAN NOT NULL DEFAULT false,
  disqualified_reason TEXT,
  signup_fingerprint  TEXT
);

CREATE INDEX IF NOT EXISTS idx_amb_ref_ambassador ON ambassador_referrals(ambassador_id, attributed_at DESC);
CREATE INDEX IF NOT EXISTS idx_amb_ref_user       ON ambassador_referrals(user_id);
CREATE INDEX IF NOT EXISTS idx_amb_ref_expiry     ON ambassador_referrals(commission_until)
  WHERE disqualified = false;

-- ── Commission ledger ──────────────────────────────────────────────────
-- One row per commissionable payment. source_id is the Stripe object (checkout
-- session or invoice) and is UNIQUE — that single constraint is what makes
-- accrual safe under webhook retries. Deliberately a plain UNIQUE column, not
-- a partial index: ON CONFLICT only matches a partial index when the statement
-- repeats its predicate, and getting that wrong is what silently dropped three
-- months of subscription rows earlier this year.
CREATE TABLE IF NOT EXISTS ambassador_commissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_id    UUID REFERENCES ambassadors(id) ON DELETE SET NULL,
  referral_id      UUID REFERENCES ambassador_referrals(id) ON DELETE SET NULL,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  source_id        TEXT NOT NULL UNIQUE,               -- cs_... or in_...
  source_kind      TEXT NOT NULL,                      -- pack | subscription | other
  stripe_event_id  TEXT,
  -- Refund and dispute events identify the payment by intent, never by the
  -- checkout session or invoice, so the link has to be stored at accrual time.
  payment_intent   TEXT,
  gross_cents      INT NOT NULL,
  commission_pct   NUMERIC(5,2) NOT NULL,
  commission_cents INT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',    -- pending | available | clawed_back | void
  available_at     TIMESTAMPTZ NOT NULL,
  released_at      TIMESTAMPTZ,
  clawed_back_at   TIMESTAMPTZ,
  clawback_reason  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT amb_comm_status_chk CHECK (status IN ('pending','available','clawed_back','void'))
);

CREATE INDEX IF NOT EXISTS idx_amb_comm_ambassador ON ambassador_commissions(ambassador_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amb_comm_user       ON ambassador_commissions(user_id);
-- Drives the nightly release job.
CREATE INDEX IF NOT EXISTS idx_amb_comm_due        ON ambassador_commissions(available_at)
  WHERE status = 'pending';

-- ── Click tracking ─────────────────────────────────────────────────────
-- Aggregated per day rather than per hit: an ambassador link can be scraped
-- thousands of times and a row-per-click table would dwarf every other table
-- here while answering the same question.
CREATE TABLE IF NOT EXISTS ambassador_click_days (
  ambassador_id UUID NOT NULL REFERENCES ambassadors(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  clicks        INT NOT NULL DEFAULT 0,
  uniques       INT NOT NULL DEFAULT 0,
  PRIMARY KEY (ambassador_id, day)
);

-- Distinct-visitor dedupe within a day. Hashed, never the raw IP.
CREATE TABLE IF NOT EXISTS ambassador_click_seen (
  ambassador_id UUID NOT NULL REFERENCES ambassadors(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  visitor_hash  TEXT NOT NULL,
  PRIMARY KEY (ambassador_id, day, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_amb_click_seen_day ON ambassador_click_seen(day);

-- Guard for databases that already ran an earlier revision of this file.
ALTER TABLE ambassador_commissions ADD COLUMN IF NOT EXISTS payment_intent TEXT;
CREATE INDEX IF NOT EXISTS idx_amb_comm_pi ON ambassador_commissions(payment_intent)
  WHERE payment_intent IS NOT NULL;
