/**
 * Shared classification + windowing for admin analytics.
 *
 * Every admin panel used to filter `usage_log` and `transactions` its own way,
 * so panels disagreed with each other and with Stripe. This module is the one
 * place those rules live. The rules exist because neither table is a clean
 * fact table:
 *
 * `usage_log`
 *   - Refunds MUTATE the row in place: `mode = mode || '-refunded'` plus
 *     `execution_time_ms = 0` (see comfyui.ts:3506, comfyui.ts:3465,
 *     support-bot.ts:228). Two consequences:
 *       • `credits_used` stays positive even though the user got the credits
 *         back, so summing it overstates consumption.
 *       • the GPU seconds are erased even though RunPod really billed them,
 *         so summing execution time understates cost.
 *     A row can be suffixed more than once (`-refunded-refunded-refunded`),
 *     so the base mode is everything before the FIRST `-refunded`.
 *   - Several modes are not jobs at all: `share`/`share-repeat` are analytics
 *     pings at 0 credits, `chat-message` is text, `goodwill-discount-rounding`
 *     is a negative credit adjustment. Counting them as generations added
 *     ~21k phantom rows.
 *   - Cost provider differs per mode: `comfy-*` runs on RunPod, `seedance-*`
 *     on BytePlus, the rest were the xAI era.
 *
 * `transactions`
 *   - Admin credit grants are written as `type = 'pack'` WITH a
 *     stripe_session_id, at `amount_cents = 0`. There are 3,774 of them, so
 *     "total transactions" and "pack purchases" both roughly doubled and the
 *     gateway breakdown filed every one of them under Stripe. Revenue must
 *     count only `amount_cents > 0`.
 *   - `payment_method` is the Stripe payment-method type, not a gateway:
 *     card, link, apple_pay, google_pay, cashapp, klarna, affirm, pix, blik,
 *     eps, kakao_pay, naver_pay, pay_by_bank, afterpay_clearpay … The old
 *     three-way switch collapsed all of that into "stripe" and misfiled
 *     `xrge-bank` (no session id) as "other".
 */

/** Modes that are analytics events or ledger adjustments, never a job. */
export const NON_JOB_MODES = [
  "share",
  "share-repeat",
  "chat-message",
  "goodwill-discount-rounding",
] as const;

const NON_JOB_LIST = NON_JOB_MODES.map((m) => `'${m}'`).join(",");

/** Mode with every refund suffix stripped: `comfy-klein-refunded-support` → `comfy-klein`. */
export const SQL_BASE_MODE = `split_part(mode, '-refunded', 1)`;

/** True for a row whose credits were handed back. */
export const SQL_IS_REFUND = `mode LIKE '%-refunded%'`;

/** True for a real generation job (refunded ones included — they still ran). */
export const SQL_IS_JOB = `mode NOT IN (${NON_JOB_LIST})`;

/** Credits the user actually kept spending — refunds net to zero. */
export const SQL_NET_CREDITS = `CASE WHEN ${SQL_IS_REFUND} THEN 0 ELSE credits_used END`;

/** Which vendor's bill a row lands on. */
export const SQL_PROVIDER = `CASE
  WHEN mode LIKE 'comfy-%'    THEN 'runpod'
  WHEN mode LIKE 'seedance-%' THEN 'seedance'
  WHEN mode LIKE 'moderation-%' OR mode LIKE 'gltch-edit%'
    OR ${SQL_BASE_MODE} IN ('generate-image','edit-image','generate-video','edit-video') THEN 'xai'
  ELSE 'none'
END`;

/**
 * RunPod serverless rate baked into `api_cost_cents` at write time
 * (comfyui.ts:3181). One flat rate for every endpoint, which is the H200
 * (HOPPER_141) flex price — jobs that land on the cheaper ADA_24 workers in
 * the same endpoint's GPU list are therefore overstated. We do NOT rewrite
 * stored values; the balance-snapshot reconciliation below is what tells you
 * how far off the assumption is in aggregate.
 */
export const RUNPOD_CENTS_PER_SEC = 0.155;

/**
 * xAI list pricing for the pre-RunPod era, in cents per credit spent.
 * Images billed $0.02, video $0.05/sec, and a moderation block still billed
 * at the higher rate. Only used to backfill rows with no `api_cost_cents`.
 */
export const SQL_XAI_EST_CENTS = `CASE
  WHEN ${SQL_BASE_MODE} IN ('generate-image','edit-image') THEN credits_used * 2
  ELSE credits_used * 5
END`;

// ── Windowing ────────────────────────────────────────────────────────────────

export type Bucket = "day" | "week" | "month";

export interface Range {
  /** Days back from now, or null for all-time. */
  days: number | null;
  bucket: Bucket;
  /** Human label for the UI, e.g. "90d" or "all". */
  label: string;
}

const BUCKETS: Bucket[] = ["day", "week", "month"];

/**
 * Parse `{ days, bucket }` off a request body.
 *
 * `days` accepts a positive integer or "all"/0 for all-time. Default 30 keeps
 * every existing caller on its old window. `bucket` is whitelisted rather than
 * merely parameterized because it is interpolated into `date_trunc`.
 */
export function parseRange(body: any, defaultDays = 30): Range {
  const raw = body?.days;
  let days: number | null = defaultDays;
  if (raw === "all" || raw === 0 || raw === "0") {
    days = null;
  } else if (raw !== undefined && raw !== null) {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n > 0) days = Math.min(n, 3650);
  }

  let bucket = BUCKETS.includes(body?.bucket) ? (body.bucket as Bucket) : null;
  if (!bucket) {
    // Auto: keep the point count readable without the caller having to think.
    const d = days ?? 3650;
    bucket = d <= 92 ? "day" : d <= 400 ? "week" : "month";
  }

  return { days, bucket, label: days === null ? "all" : `${days}d` };
}

/**
 * SQL predicate for the range, as a fragment plus its parameters.
 *
 * Returns `TRUE` for all-time so callers can always concatenate it into a
 * WHERE clause. `startIndex` is the next free `$n` placeholder.
 */
export function rangeClause(
  range: Range,
  column = "created_at",
  startIndex = 1,
): { sql: string; params: any[]; nextIndex: number } {
  if (range.days === null) {
    return { sql: "TRUE", params: [], nextIndex: startIndex };
  }
  return {
    sql: `${column} >= now() - make_interval(days => $${startIndex})`,
    params: [range.days],
    nextIndex: startIndex + 1,
  };
}

/**
 * A gap-free bucket series so charts don't draw a straight line across days
 * that simply had no rows. All-time starts at the first row in `table`.
 */
export function bucketSeriesCte(
  range: Range,
  table: string,
  alias = "buckets",
  column = "created_at",
): string {
  const start =
    range.days === null
      ? `(SELECT date_trunc('${range.bucket}', MIN(${column})) FROM ${table})`
      : `date_trunc('${range.bucket}', now() - make_interval(days => ${range.days}))`;
  return `${alias} AS (
    SELECT generate_series(
      ${start},
      date_trunc('${range.bucket}', now()),
      '1 ${range.bucket}'::interval
    )::date AS bucket
  )`;
}

// ── Gateway classification ───────────────────────────────────────────────────

/**
 * Real settlement rail. `payment_method` holds the Stripe payment-method type
 * for anything that went through Checkout, so "is there a session id" is the
 * question that separates rails; the method itself is the sub-breakdown.
 */
export const SQL_GATEWAY = `CASE
  WHEN payment_method = 'admin'      THEN 'grant'
  WHEN payment_method = 'xrge'       THEN 'xrge'
  WHEN payment_method = 'xrge-bank'  THEN 'xrge-bank'
  WHEN payment_method = 'paypal'     THEN 'paypal'
  WHEN stripe_session_id IS NOT NULL THEN 'stripe'
  ELSE 'other'
END`;

/** Only rows where money actually moved. */
export const SQL_IS_REVENUE = `amount_cents > 0`;
