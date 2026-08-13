/**
 * Ambassador program — attribution, commission accrual, clawback, release.
 *
 * The money model in one paragraph: an approved ambassador gets a percentage
 * of what their referred customers actually *pay*, not of who they sign up.
 * Every commissionable Stripe payment writes one row here keyed on the Stripe
 * object id, so webhook retries are free. Rows land as `pending`, mature into
 * `available` after the ambassador's hold window (30 days by default, which
 * covers most of the dispute window), and only then move real cents into
 * users.cash_balance_cents where the existing payout rails can withdraw them.
 * A refund or dispute claws the row back, reversing the balance if it had
 * already been released.
 *
 * Everything in here is written to be safe to run twice. webhook.ts marks an
 * event processed *before* running its handler body, so a mid-handler failure
 * is remembered as a success and Stripe's retry short-circuits — idempotency
 * has to live in the statements themselves, not in the caller.
 */

import crypto from "crypto";

type Sql = ReturnType<typeof import("./db").getDb>;

/** Codes that shouldn't be claimable as vanity handles. */
const RESERVED_CODES = new Set([
  "admin", "gltch", "gltchrunner", "grokrunner", "official", "support", "help",
  "team", "staff", "mod", "moderator", "system", "api", "www", "app", "root",
  "null", "undefined", "test", "signup", "login", "referral", "ambassador",
]);

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

/** Normalize a user-supplied code to its canonical stored form. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Validate a requested vanity code. Returns null when acceptable, otherwise a
 * message safe to show the applicant.
 */
export function validateCode(raw: unknown): string | null {
  const code = normalizeCode(raw);
  if (!code) return "Pick a code";
  if (code.length < 3) return "Code must be at least 3 characters";
  if (code.length > 24) return "Code must be 24 characters or less";
  if (!CODE_RE.test(code)) return "Use letters, numbers, dashes and underscores only";
  if (RESERVED_CODES.has(code.toLowerCase())) return "That code is reserved";
  return null;
}

/** Generate a fallback code from a display name or at random. */
export function suggestCode(displayName?: string | null): string {
  const base = normalizeCode(displayName).replace(/[^A-Z0-9]/g, "").slice(0, 16);
  if (base.length >= 3 && !RESERVED_CODES.has(base.toLowerCase())) return base;
  return "AMB" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/** Is this code free across both ambassador codes and legacy referral codes? */
export async function isCodeAvailable(sql: Sql, code: string, exceptAmbassadorId?: string): Promise<boolean> {
  const norm = normalizeCode(code);
  const [taken] = await sql`
    SELECT 1 AS hit FROM ambassadors
    WHERE LOWER(code) = LOWER(${norm})
      AND (${exceptAmbassadorId ?? null}::uuid IS NULL OR id <> ${exceptAmbassadorId ?? null}::uuid)
    UNION ALL
    SELECT 1 FROM users WHERE UPPER(referral_code) = ${norm}
    LIMIT 1
  `;
  return !taken;
}

export interface AmbassadorLookup {
  ambassadorId: string;
  userId: string | null;
  code: string;
  commissionMonths: number;
}

/**
 * Resolve a signup code to an active ambassador. Case-insensitive; returns
 * null for paused/revoked ambassadors so their links stop earning immediately
 * without breaking signup itself.
 */
export async function findAmbassadorByCode(sql: Sql, rawCode: unknown): Promise<AmbassadorLookup | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const [row] = await sql`
    SELECT id, user_id, code, commission_months
    FROM ambassadors
    WHERE LOWER(code) = LOWER(${code}) AND status = 'active'
    LIMIT 1
  `;
  if (!row) return null;
  return {
    ambassadorId: row.id,
    userId: row.user_id,
    code: row.code,
    commissionMonths: row.commission_months,
  };
}

/**
 * Attach a newly signed-up user to an ambassador.
 *
 * Fraud is handled by recording the attribution and marking it disqualified
 * rather than refusing it — a rejected row tells you nothing later, whereas a
 * disqualified one with a reason is evidence of a pattern. Disqualified rows
 * never accrue commission.
 *
 * Safe to call twice: the UNIQUE on user_id makes the second call a no-op.
 */
export async function attributeSignup(
  sql: Sql,
  opts: { ambassadorId: string; ambassadorUserId: string | null; userId: string; fingerprint?: string | null },
): Promise<void> {
  const { ambassadorId, ambassadorUserId, userId, fingerprint } = opts;

  let disqualified = false;
  let reason: string | null = null;

  if (ambassadorUserId && ambassadorUserId === userId) {
    disqualified = true;
    reason = "self-referral";
  } else if (fingerprint && ambassadorUserId) {
    const [same] = await sql`
      SELECT 1 AS hit FROM users
      WHERE id = ${ambassadorUserId}::uuid AND device_fingerprint = ${fingerprint}
      LIMIT 1
    `;
    if (same) {
      disqualified = true;
      reason = "same device fingerprint as ambassador";
    }
  }

  await sql`
    INSERT INTO ambassador_referrals
      (ambassador_id, user_id, commission_until, disqualified, disqualified_reason, signup_fingerprint)
    SELECT ${ambassadorId}::uuid, ${userId}::uuid,
           CASE WHEN a.commission_months > 0
                THEN now() + (a.commission_months * INTERVAL '1 month')
                ELSE NULL END,
           ${disqualified}, ${reason}, ${fingerprint ?? null}
    FROM ambassadors a WHERE a.id = ${ambassadorId}::uuid
    ON CONFLICT (user_id) DO NOTHING
  `;
}

export interface AccrualResult {
  commissionId: string;
  ambassadorId: string;
  commissionCents: number;
  availableAt: string;
}

/**
 * Book commission for a settled payment.
 *
 * `sourceId` must be the Stripe object id (checkout session or invoice) — it
 * carries the UNIQUE constraint that makes this idempotent. Returns null when
 * there's nothing to book: no attribution, expired window, disqualified,
 * paused ambassador, or the payment was already accrued.
 */
export async function accrueCommission(
  sql: Sql,
  opts: {
    userId: string;
    sourceId: string;
    sourceKind: "pack" | "subscription" | "other";
    grossCents: number;
    eventId?: string | null;
    paymentIntent?: string | null;
  },
): Promise<AccrualResult | null> {
  const { userId, sourceId, sourceKind, grossCents, eventId, paymentIntent } = opts;
  if (!userId || !sourceId || !Number.isFinite(grossCents) || grossCents <= 0) return null;

  const [live] = await sql`
    SELECT r.id AS referral_id, r.ambassador_id, a.commission_pct, a.hold_days
    FROM ambassador_referrals r
    JOIN ambassadors a ON a.id = r.ambassador_id
    WHERE r.user_id = ${userId}::uuid
      AND r.disqualified = false
      AND a.status = 'active'
      AND (r.commission_until IS NULL OR r.commission_until > now())
    LIMIT 1
  `;
  if (!live) return null;

  const pct = Number(live.commission_pct);
  const commissionCents = Math.round((grossCents * pct) / 100);
  if (commissionCents <= 0) return null;

  // One statement so the ledger row and both rollup counters can't diverge —
  // the Neon HTTP driver autocommits per statement and has no transactions,
  // so anything split across calls can half-apply.
  const [row] = await sql`
    WITH ins AS (
      INSERT INTO ambassador_commissions
        (ambassador_id, referral_id, user_id, source_id, source_kind, stripe_event_id,
         payment_intent, gross_cents, commission_pct, commission_cents, available_at)
      VALUES
        (${live.ambassador_id}::uuid, ${live.referral_id}::uuid, ${userId}::uuid,
         ${sourceId}, ${sourceKind}, ${eventId ?? null}, ${paymentIntent ?? null},
         ${grossCents}, ${pct}, ${commissionCents},
         now() + (${live.hold_days}::int * INTERVAL '1 day'))
      ON CONFLICT (source_id) DO NOTHING
      RETURNING id, ambassador_id, referral_id, gross_cents, commission_cents, available_at
    ), bump_ref AS (
      UPDATE ambassador_referrals r
      SET gross_cents = r.gross_cents + ins.gross_cents,
          commission_cents = r.commission_cents + ins.commission_cents,
          first_paid_at = COALESCE(r.first_paid_at, now())
      FROM ins WHERE r.id = ins.referral_id
      RETURNING 1
    ), bump_amb AS (
      UPDATE ambassadors a
      SET lifetime_gross_cents = a.lifetime_gross_cents + ins.gross_cents,
          lifetime_commission_cents = a.lifetime_commission_cents + ins.commission_cents,
          updated_at = now()
      FROM ins WHERE a.id = ins.ambassador_id
      RETURNING 1
    )
    SELECT id, ambassador_id, commission_cents, available_at FROM ins
  `;

  if (!row) return null; // already booked for this Stripe object

  return {
    commissionId: row.id,
    ambassadorId: row.ambassador_id,
    commissionCents: row.commission_cents,
    availableAt: row.available_at,
  };
}

/**
 * Reverse commission for a refunded or disputed payment.
 *
 * If the commission was still pending it simply voids. If it had already been
 * released into cash_balance_cents, the balance is debited — which can push it
 * negative, and should: that's an honest representation of an ambassador who
 * was paid for revenue that went away. Payout requests already refuse to
 * withdraw more than the balance, so a negative simply blocks withdrawal until
 * it's earned back.
 */
export async function clawbackCommission(
  sql: Sql,
  opts: { sourceId?: string | null; paymentIntent?: string | null; reason: string },
): Promise<{ commissionCents: number; wasReleased: boolean } | null> {
  const { sourceId, paymentIntent, reason } = opts;
  if (!sourceId && !paymentIntent) return null;

  const [row] = await sql`
    WITH target AS (
      SELECT id, ambassador_id, referral_id, gross_cents, commission_cents, status
      FROM ambassador_commissions
      WHERE status IN ('pending', 'available')
        AND (
          (${sourceId ?? null}::text IS NOT NULL AND source_id = ${sourceId ?? null})
          OR (${paymentIntent ?? null}::text IS NOT NULL AND payment_intent = ${paymentIntent ?? null})
        )
      LIMIT 1
    ), upd AS (
      UPDATE ambassador_commissions c
      SET status = 'clawed_back', clawed_back_at = now(), clawback_reason = ${reason}
      FROM target t WHERE c.id = t.id
      RETURNING c.id
    ), unbump_ref AS (
      UPDATE ambassador_referrals r
      SET gross_cents = GREATEST(0, r.gross_cents - t.gross_cents),
          commission_cents = GREATEST(0, r.commission_cents - t.commission_cents)
      FROM target t WHERE r.id = t.referral_id
      RETURNING 1
    ), unbump_amb AS (
      UPDATE ambassadors a
      SET lifetime_gross_cents = GREATEST(0, a.lifetime_gross_cents - t.gross_cents),
          lifetime_commission_cents = GREATEST(0, a.lifetime_commission_cents - t.commission_cents),
          updated_at = now()
      FROM target t WHERE a.id = t.ambassador_id
      RETURNING 1
    ), debit AS (
      UPDATE users u
      SET cash_balance_cents = u.cash_balance_cents - t.commission_cents, updated_at = now()
      FROM target t
      JOIN ambassadors a ON a.id = t.ambassador_id
      WHERE u.id = a.user_id AND t.status = 'available'
      RETURNING u.id
    )
    SELECT t.commission_cents, (t.status = 'available') AS was_released FROM target t
  `;

  if (!row) return null;
  return { commissionCents: row.commission_cents, wasReleased: row.was_released };
}

/**
 * Move matured commissions into withdrawable cash. Run from cron.
 *
 * Revoked ambassadors and ambassadors whose user account is gone are voided
 * instead of paid — marking them `available` without moving cents would leave
 * money owed to nobody sitting in the ledger as if it were payable.
 */
export interface ReleaseResult {
  released: number;
  releasedCents: number;
  voided: number;
  /** Per-ambassador breakdown so the caller can tell them their money moved. */
  recipients: { userId: string; cents: number; count: number }[];
}

export async function releaseMaturedCommissions(sql: Sql, limit = 500): Promise<ReleaseResult> {
  const [res] = await sql`
    WITH due AS (
      SELECT c.id, c.commission_cents, a.user_id, a.status AS amb_status
      FROM ambassador_commissions c
      JOIN ambassadors a ON a.id = c.ambassador_id
      WHERE c.status = 'pending' AND c.available_at <= now()
      ORDER BY c.available_at
      LIMIT ${limit}
    ), payable AS (
      SELECT * FROM due WHERE amb_status <> 'revoked' AND user_id IS NOT NULL
    ), dead AS (
      SELECT * FROM due WHERE amb_status = 'revoked' OR user_id IS NULL
    ), rel AS (
      UPDATE ambassador_commissions c
      SET status = 'available', released_at = now()
      FROM payable p WHERE c.id = p.id AND c.status = 'pending'
      RETURNING c.id, c.commission_cents
    ), void_dead AS (
      UPDATE ambassador_commissions c
      SET status = 'void', clawback_reason = 'ambassador revoked or account removed'
      FROM dead d WHERE c.id = d.id AND c.status = 'pending'
      RETURNING c.id
    ), credited AS (
      UPDATE users u
      SET cash_balance_cents = u.cash_balance_cents + agg.total, updated_at = now()
      FROM (
        SELECT p.user_id, SUM(p.commission_cents)::int AS total
        FROM payable p JOIN rel ON rel.id = p.id
        GROUP BY p.user_id
      ) agg
      WHERE u.id = agg.user_id
      RETURNING u.id
    )
    SELECT
      (SELECT COUNT(*) FROM rel)::int AS released,
      (SELECT COALESCE(SUM(commission_cents), 0) FROM rel)::int AS released_cents,
      (SELECT COUNT(*) FROM void_dead)::int AS voided,
      (SELECT COALESCE(
                json_agg(json_build_object('userId', x.user_id, 'cents', x.cents, 'count', x.n)),
                '[]'::json)
         FROM (
           SELECT p.user_id, SUM(p.commission_cents)::int AS cents, COUNT(*)::int AS n
           FROM payable p JOIN rel ON rel.id = p.id
           GROUP BY p.user_id
         ) x
      ) AS recipients
  `;
  return {
    released: res?.released ?? 0,
    releasedCents: res?.released_cents ?? 0,
    voided: res?.voided ?? 0,
    recipients: (res?.recipients ?? []) as ReleaseResult["recipients"],
  };
}

/** Hash a visitor for same-day click dedupe. Never stores a raw IP. */
export function visitorHash(ip: string, ua: string): string {
  const salt = process.env.JWT_SECRET || "gltch";
  return crypto.createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex").slice(0, 32);
}
