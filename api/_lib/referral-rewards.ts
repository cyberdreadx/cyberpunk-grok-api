/**
 * Referral activation rewards.
 *
 * The referral programme pays only when a referred user BUYS something (+10 to
 * the referrer, +5 to the buyer, in webhook.ts). That is unfarmable but nearly
 * invisible: 79 of 2,960 signups in the last 90 days arrived through a referral
 * link, and most referrers never see a credit, so nobody shares one.
 *
 * This adds the missing middle step — a reward when the referred person turns
 * into a real user — while staying honest about why the old version was killed.
 * A signup-triggered referee grant existed until the 2026-07 earn-only overhaul
 * (commit ec4dad4) and was retired with the other auto-grant faucets because
 * farms minted accounts for it. So the trigger here is deliberately not signup:
 *
 *   verified email          — costs the farmer a working inbox
 *   account at least a day old — defeats the burst-create pattern every farm wave used
 *   3 real generations      — a farmer CAN fake this, but it costs them GPU to do it
 *   a device fingerprint that differs from the referrer's, and from every other
 *   referee that referrer has brought — self-referral and device rings are how
 *   every previous wave worked (85 accounts on one fingerprint, then 51, then 44)
 *   neither side banned
 *   a rolling weekly cap per referrer, on top of the existing 50 lifetime cap
 *
 * The economics: 15 + 15 credits is about 53c of GPU at cost. A referred user
 * who activates is worth well more than that even at a 2% chance of ever paying
 * against an $89 average lifetime value — but only if they are a person.
 */

import type { getDb } from "./db";
import { logCreditGrant } from "./credit-ledger";

export const REFERRAL_CONFIG_KEY = "referral_rewards";

export interface ReferralConfig {
  enabled: boolean;
  dryRun: boolean;
  referrerCredits: number;
  refereeCredits: number;
  minGenerations: number;
  minAgeHours: number;
  weeklyCapPerReferrer: number;
  lifetimeCap: number;
  maxPerRun: number;
  /** Only referrals created on or after this pay out — see cron-referral-rewards.ts. */
  since: string | null;
}

const DEFAULTS: ReferralConfig = {
  enabled: false,
  dryRun: true,
  referrerCredits: 15,
  refereeCredits: 15,
  minGenerations: 3,
  minAgeHours: 24,
  weeklyCapPerReferrer: 5,
  lifetimeCap: 50,
  maxPerRun: 100,
  since: null,
};

export async function readReferralConfig(sql: ReturnType<typeof getDb>): Promise<ReferralConfig> {
  const rows = await sql`SELECT value FROM app_config WHERE key = ${REFERRAL_CONFIG_KEY} LIMIT 1`;
  const raw = rows.length ? (rows[0] as { value: unknown }).value : null;
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const v = raw as Partial<ReferralConfig>;
  const num = (x: unknown, d: number, max: number) => Math.min(Math.max(Number(x) || d, 0), max);
  return {
    enabled: v.enabled === true,
    dryRun: v.dryRun !== false,
    referrerCredits: num(v.referrerCredits, DEFAULTS.referrerCredits, 100),
    refereeCredits: num(v.refereeCredits, DEFAULTS.refereeCredits, 100),
    minGenerations: num(v.minGenerations, DEFAULTS.minGenerations, 50),
    minAgeHours: num(v.minAgeHours, DEFAULTS.minAgeHours, 720),
    weeklyCapPerReferrer: num(v.weeklyCapPerReferrer, DEFAULTS.weeklyCapPerReferrer, 100),
    lifetimeCap: num(v.lifetimeCap, DEFAULTS.lifetimeCap, 1000),
    maxPerRun: num(v.maxPerRun, DEFAULTS.maxPerRun, 500),
    since: typeof v.since === "string" ? v.since : null,
  };
}

export interface PendingActivation {
  id: string;
  referrerId: string;
  refereeId: string;
  refereeEmail: string;
  generations: number;
}

/**
 * Referrals that have earned an activation reward and not been paid one.
 *
 * Every guard is in this one query on purpose: a caller cannot forget one, and
 * the whole rule set can be read in a single place when someone asks why a
 * particular referral did or did not pay.
 */
export async function pendingActivations(
  sql: ReturnType<typeof getDb>,
  cfg: ReferralConfig,
  limit: number,
): Promise<PendingActivation[]> {
  const rows = (await sql`
    SELECT r.id, r.referrer_id, r.referee_id, ue.email AS referee_email,
      (SELECT COUNT(*)::int FROM usage_log l
        WHERE l.user_id = r.referee_id AND l.mode NOT LIKE '%refunded%') AS generations
    FROM referrals r
    JOIN users ue ON ue.id = r.referee_id
    JOIN users ur ON ur.id = r.referrer_id
    WHERE r.referee_signup_reward = false
      AND r.referee_verified = true
      AND r.referrer_id <> r.referee_id
      AND (${cfg.since}::timestamptz IS NULL OR r.created_at >= ${cfg.since}::timestamptz)
      AND ue.created_at < now() - (${cfg.minAgeHours} || ' hours')::interval
      AND NOT EXISTS (SELECT 1 FROM user_bans b WHERE b.user_id = ue.id AND (b.expires_at IS NULL OR b.expires_at > now()))
      AND NOT EXISTS (SELECT 1 FROM user_bans b WHERE b.user_id = ur.id AND (b.expires_at IS NULL OR b.expires_at > now()))
      -- a real session, not a burst-created shell
      AND (SELECT COUNT(*) FROM usage_log l WHERE l.user_id = r.referee_id AND l.mode NOT LIKE '%refunded%') >= ${cfg.minGenerations}
      -- self-referral: same device as the person who invited them
      AND COALESCE(ue.device_fingerprint, '') <> ''
      AND COALESCE(ue.device_fingerprint, '') <> COALESCE(ur.device_fingerprint, '~none~')
      -- a ring: this referrer already brought someone in on that same device
      AND NOT EXISTS (
        SELECT 1 FROM referrals r2
        JOIN users u2 ON u2.id = r2.referee_id
        WHERE r2.referrer_id = r.referrer_id AND r2.id <> r.id
          AND u2.device_fingerprint = ue.device_fingerprint
      )
      -- caps: lifetime, and a rolling week
      AND (SELECT COUNT(*) FROM referrals rc
           WHERE rc.referrer_id = r.referrer_id AND rc.referrer_rewarded = true) < ${cfg.lifetimeCap}
      AND (SELECT COUNT(*) FROM credit_ledger cl
           WHERE cl.user_id = r.referrer_id AND cl.source = 'referral_activation'
             AND cl.created_at > now() - interval '7 days') < ${cfg.weeklyCapPerReferrer}
    ORDER BY r.created_at ASC
    LIMIT ${limit}
  `) as any[];
  return rows.map((r) => ({
    id: String(r.id),
    referrerId: String(r.referrer_id),
    refereeId: String(r.referee_id),
    refereeEmail: String(r.referee_email),
    generations: Number(r.generations),
  }));
}

/**
 * Claim the row first, then pay. The claim is the idempotency key — two
 * overlapping runs cannot both pay the same referral — and a failed grant
 * releases it so the next run retries rather than silently swallowing it.
 */
export async function payActivation(
  sql: ReturnType<typeof getDb>,
  cfg: ReferralConfig,
  a: PendingActivation,
): Promise<boolean> {
  const claimed = (await sql`
    UPDATE referrals SET referee_signup_reward = true
    WHERE id = ${a.id}::uuid AND referee_signup_reward = false
    RETURNING id
  `) as any[];
  if (claimed.length === 0) return false;

  // Re-check the weekly cap HERE, not just in the candidate query. The query
  // runs once for the whole batch, so every row in it passes a cap that only
  // starts being consumed as the batch is paid — the same batch-vs-item trap
  // that let one person receive two lifecycle emails in a single run.
  const [week] = (await sql`
    SELECT COUNT(*)::int AS n FROM credit_ledger
    WHERE user_id = ${a.referrerId}::uuid AND source = 'referral_activation'
      AND created_at > now() - interval '7 days'
  `) as any[];
  if (Number(week?.n ?? 0) >= cfg.weeklyCapPerReferrer) {
    await sql`UPDATE referrals SET referee_signup_reward = false WHERE id = ${a.id}::uuid`;
    return false;
  }

  try {
    await sql`SELECT add_pack_credits(${a.referrerId}::uuid, ${cfg.referrerCredits})`;
    await sql`SELECT add_pack_credits(${a.refereeId}::uuid, ${cfg.refereeCredits})`;
    await logCreditGrant(sql, a.referrerId, cfg.referrerCredits, "referral_activation", a.id);
    await logCreditGrant(sql, a.refereeId, cfg.refereeCredits, "referral_activation_bonus", a.id);
    return true;
  } catch (err: any) {
    await sql`UPDATE referrals SET referee_signup_reward = false WHERE id = ${a.id}::uuid`;
    console.error("[referral-rewards] grant failed, claim released:", err?.message);
    return false;
  }
}
