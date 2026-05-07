/**
 * GET /api/v1/xrge-balance
 * Returns the user's XRGE bank balance, loyalty tier (spend-based),
 * holder tier (hold-based), recent transactions, and deposit address.
 *
 * Auth: X-API-Key or Authorization: Bearer JWT.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { getXrgeConfig } from "../_lib/xrge";
import { getBankUser, getTierForSpend, getNextTier, LOYALTY_TIERS } from "./_lib/xrge-bank";
import { getHolderState, HOLDER_TIERS, STREAK_BONUSES } from "./_lib/xrge-holder";

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

    // XRGE config (price feed + deposit address). Don't fail the whole
    // balance endpoint if the price feed is briefly down or env is missing.
    let config: { depositAddress: string | null; usdRate: number | null } = {
      depositAddress: null,
      usdRate: null,
    };
    const warnings: { code: string; message: string }[] = [];
    try {
      const c = await getXrgeConfig();
      config = { depositAddress: c.depositAddress, usdRate: c.usdRate };
    } catch (e: any) {
      console.warn("[xrge-balance] getXrgeConfig failed:", e.message);
      const msg = String(e?.message || "");
      if (msg.includes("XRGE_DEPOSIT_ADDRESS")) {
        warnings.push({
          code: "deposit_address_missing",
          message: "Deposits are temporarily unavailable — the deposit address isn't configured on the server.",
        });
      } else if (msg.includes("DexScreener") || msg.includes("XRGE price") || msg.includes("trading pair")) {
        warnings.push({
          code: "price_feed_down",
          message: "Live XRGE/USD price feed is unavailable right now. Your balance is still correct; pricing-dependent actions may be delayed.",
        });
      } else {
        warnings.push({
          code: "config_unavailable",
          message: "XRGE configuration couldn't be loaded. Some actions may be temporarily limited.",
        });
      }
    }

    // Recent bank transactions (last 20)
    const txns = await sql`
      SELECT id, type, amount, balance_after, tx_hash, metadata, created_at
      FROM xrge_bank_txns
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 20
    `.catch((e: any) => {
      console.warn("[xrge-balance] txns query failed:", e.message);
      return [];
    });

    // Pending withdrawals
    const pendingWithdrawals = await sql`
      SELECT id, amount, to_address, status, created_at
      FROM xrge_withdrawals
      WHERE user_id = ${userId} AND status IN ('pending', 'processing')
      ORDER BY created_at DESC
    `.catch((e: any) => {
      console.warn("[xrge-balance] withdrawals query failed:", e.message);
      return [];
    });

    // Holder tier (hold-based, separate from spend-based loyalty).
    // Migration 035 may not be applied in all envs — degrade gracefully.
    let holder: Awaited<ReturnType<typeof getHolderState>> | null = null;
    try {
      holder = await getHolderState(sql, userId);
    } catch (e: any) {
      console.warn("[xrge-balance] getHolderState failed:", e.message);
    }

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
      // ── Holder tier block ──────────────────────────────────────────
      holder: holder ? {
        tier: holder.tier.id,
        tierName: holder.tier.name,
        tierRank: holder.tier.rank,
        discountPercent: holder.tier.discountPercent,
        dailyCreditBonus: holder.tier.dailyCreditBonus,
        description: holder.tier.description,
        totalHeld: holder.totalHeld,
        walletBalance: holder.walletBalance,
        bankBalance: holder.bankBalance,
        walletAddress: holder.walletAddress,
        streakDays: holder.streakDays,
        streakBonus: holder.streakBonus,
        effectiveDiscount: holder.effectiveDiscount,
        effectiveDailyBonus: holder.effectiveDailyBonus,
        lastSnapshotAt: holder.lastSnapshotAt,
        nextTier: holder.nextTier ? {
          id: holder.nextTier.id,
          name: holder.nextTier.name,
          rank: holder.nextTier.rank,
          minHeld: holder.nextTier.minHeld,
          discountPercent: holder.nextTier.discountPercent,
          dailyCreditBonus: holder.nextTier.dailyCreditBonus,
          xrgeRemaining: holder.spendToNext,
        } : null,
        allTiers: HOLDER_TIERS,
        streakBonuses: STREAK_BONUSES,
      } : null,
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
    console.error("[xrge-balance]", err.message, err.stack);
    return res.status(500).json({ error: "Failed to fetch balance" });
  }
}
