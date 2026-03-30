/**
 * GET /api/v1/xrge-balance
 * Returns the user's XRGE bank balance, loyalty tier, lifetime spend,
 * recent transactions, and deposit address.
 *
 * Auth: X-API-Key or Authorization: Bearer JWT.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { getXrgeConfig } from "../_lib/xrge";
import { getBankUser, getTierForSpend, getNextTier, LOYALTY_TIERS } from "./_lib/xrge-bank";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const apiKeyAuth = await getUserFromApiKey(req);
    const jwtAuth = !apiKeyAuth ? getUserFromRequest(req) : null;
    const userId = apiKeyAuth?.userId || jwtAuth?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const sql = getDb();
    const user = await getBankUser(sql, userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const tier = getTierForSpend(user.lifetimeSpend);
    const nextTier = getNextTier(tier.id);

    const config = await getXrgeConfig();

    // Recent bank transactions (last 20)
    const txns = await sql`
      SELECT id, type, amount, balance_after, tx_hash, metadata, created_at
      FROM xrge_bank_txns
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    // Pending withdrawals
    const pendingWithdrawals = await sql`
      SELECT id, amount, to_address, status, created_at
      FROM xrge_withdrawals
      WHERE user_id = ${userId} AND status IN ('pending', 'processing')
      ORDER BY created_at DESC
    `;

    return res.status(200).json({
      bankBalance: user.bankBalance,
      lifetimeSpend: user.lifetimeSpend,
      loyaltyTier: tier.id,
      loyaltyTierName: tier.name,
      bonusPercent: tier.bonusPercent,
      nextTier: nextTier ? {
        id: nextTier.id,
        name: nextTier.name,
        minSpend: nextTier.minSpend,
        bonusPercent: nextTier.bonusPercent,
        spendRemaining: Math.max(0, nextTier.minSpend - user.lifetimeSpend),
      } : null,
      allTiers: LOYALTY_TIERS,
      walletAddress: user.walletAddress,
      depositAddress: config.depositAddress,
      xrgeUsdRate: config.usdRate,
      transactions: txns.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: parseFloat(t.amount),
        balanceAfter: parseFloat(t.balance_after),
        txHash: t.tx_hash,
        metadata: t.metadata,
        createdAt: t.created_at,
      })),
      pendingWithdrawals: pendingWithdrawals.map((w: any) => ({
        id: w.id,
        amount: parseFloat(w.amount),
        toAddress: w.to_address,
        status: w.status,
        createdAt: w.created_at,
      })),
    });
  } catch (err: any) {
    console.error("[xrge-balance]", err.message);
    return res.status(500).json({ error: "Failed to fetch balance" });
  }
}
