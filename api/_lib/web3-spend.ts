/**
 * GLTCH Web3 (web3.gltchrunner.com): generations are paid in XRGE.
 *
 * Same accounts, feed and backend as Runner. The only difference is where a
 * generation's cost comes from: on web3 every cost that would take credits
 * takes XRGE from the user's bank balance instead (users.xrge_bank_balance),
 * and existing credits are left alone. The site tells the API which edition
 * it is with the X-Gltch-Edition header (set once, in src/lib/api.ts).
 *
 * Costs are still defined in credits everywhere; this converts them at the
 * live XRGE price. One credit is priced like a credit bought from the bank
 * (WEB3_CENTS_PER_CREDIT, default 10¢ — the starter pack rate) less the
 * user's loyalty bonus, so paying per generation never costs more than buying
 * a credit pack with XRGE would.
 *
 * Every charge and refund is one atomic UPDATE plus a row in xrge_bank_txns
 * (type 'spend' / 'refund'), so the bank history shows each generation.
 */

import { getXrgeConfig } from "./xrge";
import { getTierForSpend } from "../v1/_lib/xrge-bank";

export const WEB3_EDITION_HEADER = "x-gltch-edition";

export function isWeb3Request(req: { headers?: Record<string, unknown> }): boolean {
  const v = req.headers?.[WEB3_EDITION_HEADER];
  return (Array.isArray(v) ? v[0] : v) === "web3";
}

function centsPerCredit(): number {
  const v = parseFloat(process.env.WEB3_CENTS_PER_CREDIT || "");
  return Number.isFinite(v) && v > 0 ? v : 10;
}

export interface XrgeQuote {
  /** XRGE for the requested credits, rounded up to a whole token. */
  xrge: number;
  xrgePerCredit: number;
  usdRate: number;
  bonusPercent: number;
}

/** What `credits` costs this user in XRGE right now. */
export async function quoteXrge(sql: any, userId: string, credits: number): Promise<XrgeQuote> {
  const { usdRate } = await getXrgeConfig();
  const [row] = await sql`SELECT COALESCE(xrge_lifetime_spend, 0) AS spend FROM users WHERE id = ${userId}`;
  const tier = getTierForSpend(parseFloat(row?.spend) || 0);
  const usdPerCredit = centsPerCredit() / 100 / (1 + tier.bonusPercent / 100);
  const xrgePerCredit = usdPerCredit / usdRate;
  return {
    xrge: credits > 0 ? Math.ceil(credits * xrgePerCredit) : 0,
    xrgePerCredit,
    usdRate,
    bonusPercent: tier.bonusPercent,
  };
}

export class InsufficientXrgeError extends Error {
  constructor(public needed: number, public available: number) {
    super(`Not enough XRGE. This costs ${needed.toLocaleString("en-US")} XRGE and your balance is ${Math.floor(available).toLocaleString("en-US")} XRGE.`);
    this.name = "InsufficientXrgeError";
  }
}

/**
 * Take the XRGE price of `credits` from the user's bank. Returns the XRGE
 * amount charged (0 for a free action) — keep it to refund exactly that.
 * Throws InsufficientXrgeError when the balance is short.
 */
export async function chargeXrge(sql: any, userId: string, credits: number, what: string): Promise<number> {
  if (credits <= 0) return 0;
  const q = await quoteXrge(sql, userId, credits);
  const [row] = await sql`
    WITH deduct AS (
      UPDATE users
      SET xrge_bank_balance = xrge_bank_balance - ${q.xrge}::numeric,
          xrge_lifetime_spend = COALESCE(xrge_lifetime_spend, 0) + ${q.xrge}::numeric,
          updated_at = now()
      WHERE id = ${userId} AND xrge_bank_balance >= ${q.xrge}::numeric
      RETURNING id, xrge_bank_balance
    ), txn AS (
      INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, note, metadata)
      SELECT id, 'spend', ${q.xrge}::numeric, xrge_bank_balance, ${what},
             ${JSON.stringify({ credits, xrgePerCredit: q.xrgePerCredit, usdRate: q.usdRate, bonusPercent: q.bonusPercent })}::jsonb
      FROM deduct
    )
    SELECT xrge_bank_balance FROM deduct
  `;
  if (!row) {
    const [u] = await sql`SELECT COALESCE(xrge_bank_balance, 0) AS b FROM users WHERE id = ${userId}`;
    throw new InsufficientXrgeError(q.xrge, parseFloat(u?.b) || 0);
  }
  return q.xrge;
}

/** Give back exactly what chargeXrge took. Safe to call with 0. */
export async function refundXrge(sql: any, userId: string, xrge: number, what: string): Promise<void> {
  if (!xrge || xrge <= 0) return;
  await sql`
    WITH credit AS (
      UPDATE users
      SET xrge_bank_balance = xrge_bank_balance + ${xrge}::numeric,
          xrge_lifetime_spend = GREATEST(COALESCE(xrge_lifetime_spend, 0) - ${xrge}::numeric, 0),
          updated_at = now()
      WHERE id = ${userId}
      RETURNING id, xrge_bank_balance
    )
    INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, note)
    SELECT id, 'refund', ${xrge}::numeric, xrge_bank_balance, ${what} FROM credit
  `;
}
