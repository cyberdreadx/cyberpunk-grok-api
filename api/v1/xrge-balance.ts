/**
 * GET /api/v1/xrge/balance — XRGE bank balance, loyalty tier, and stats.
 *
 * Auth: X-API-Key header.
 * Returns bank balance, loyalty tier info, next tier progress, and recent transactions.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { getDb } from "../_lib/db";
import {
  getBankUser,
  getTierForSpend,
  getNextTier,
  LOYALTY_TIERS,
} from "./_lib/xrge-bank";
import { getXrgeConfig } from "../_lib/xrge";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const apiAuth = await getUserFromApiKey(req);
    const jwtAuth = !apiAuth ? getUserFromRequest(req) : null;
    const userId = apiAuth?.userId || jwtAuth?.userId;
    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized. Use X-API-Key header or Bearer token.",
      });
    }

    const sql = getDb();
    const user = await getBankUser(sql, userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    let depositAddress: string | null = null;
    try {
      const cfg = await getXrgeConfig();
      depositAddress = cfg.depositAddress;
    } catch {}

    const balance = parseFloat(user.xrge_bank_balance) || 0;
    const lifetimeSpend = parseFloat(user.xrge_lifetime_spend) || 0;
    const tier = getTierForSpend(lifetimeSpend);
    const next = getNextTier(tier.id);

    const txns = await sql`
      SELECT type, amount, balance_after, tx_hash, package, credits_awarded,
             bonus_credits, loyalty_tier_at, note, created_at
      FROM xrge_bank_txns
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return res.status(200).json({
      balance: balance.toFixed(4),
      balanceRaw: user.xrge_bank_balance,
      lifetimeSpend: lifetimeSpend.toFixed(4),
      walletAddress: user.wallet_address,
      depositAddress,
      loyalty: {
        tier: tier.id,
        name: tier.name,
        bonusPercent: tier.bonusPercent,
        nextTier: next
          ? {
              tier: next.id,
              name: next.name,
              bonusPercent: next.bonusPercent,
              xrgeNeeded: (next.minSpend - lifetimeSpend).toFixed(4),
            }
          : null,
      },
      tiers: LOYALTY_TIERS.map((t) => ({
        id: t.id,
        name: t.name,
        minSpend: t.minSpend,
        bonusPercent: t.bonusPercent,
      })),
      recentTransactions: txns.map((t: any) => ({
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balance_after,
        txHash: t.tx_hash,
        package: t.package,
        creditsAwarded: t.credits_awarded,
        bonusCredits: t.bonus_credits,
        loyaltyTier: t.loyalty_tier_at,
        note: t.note,
        createdAt: t.created_at,
      })),
    });
  } catch (err: any) {
    console.error("[v1/xrge-balance]", err.message);
    return res.status(500).json({ error: "Failed to fetch XRGE balance" });
  }
}
