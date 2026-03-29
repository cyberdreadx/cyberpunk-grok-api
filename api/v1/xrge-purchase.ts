/**
 * POST /api/v1/xrge/purchase — Buy credits using XRGE bank balance.
 *
 * Auth: X-API-Key header.
 * Body: { package: string }
 *
 * Deducts XRGE from the user's custodial bank, awards credits with the
 * loyalty-tier bonus, and updates lifetime spend / tier.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";
import { getXrgeConfig, centsToXrge } from "../_lib/xrge";
import {
  getBankUser,
  getTierForSpend,
  CREDIT_PACKAGES,
} from "./_lib/xrge-bank";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiAuth = await getUserFromApiKey(req);
    const jwtAuth = !apiAuth ? getUserFromRequest(req) : null;
    const userId = apiAuth?.userId || jwtAuth?.userId;
    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized. Use X-API-Key header or Bearer token.",
      });
    }

    const rlKey = apiAuth ? `apikey:${apiAuth.apiKeyId}` : `user:${userId}`;
    const rl = await checkRateLimit(rlKey, "v1-xrge-purchase", {
      max: 20,
      windowSeconds: 300,
    });
    if (!rl.allowed) {
      return res.status(429).json({ error: "Rate limit exceeded. Try again later." });
    }

    const { package: packageId } = req.body || {};
    const pkg = CREDIT_PACKAGES[packageId];
    if (!pkg) {
      return res.status(400).json({
        error: `Unknown package "${packageId}". Valid: ${Object.keys(CREDIT_PACKAGES).join(", ")}`,
      });
    }

    const sql = getDb();
    const config = await getXrgeConfig();

    // Calculate XRGE cost at live rate
    const xrgeCost = centsToXrge(pkg.priceCents, config.usdRate);
    const xrgeCostNum = parseFloat(xrgeCost);

    // Get user's bank state
    const user = await getBankUser(sql, userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const balance = parseFloat(user.xrge_bank_balance) || 0;
    if (balance < xrgeCostNum) {
      return res.status(402).json({
        error: "Insufficient XRGE bank balance.",
        balance: balance.toFixed(4),
        required: xrgeCost,
        shortfall: (xrgeCostNum - balance).toFixed(4),
      });
    }

    // Determine loyalty bonus
    const lifetimeAfter = (parseFloat(user.xrge_lifetime_spend) || 0) + xrgeCostNum;
    const tier = getTierForSpend(lifetimeAfter);
    const bonusCredits = Math.floor(pkg.credits * (tier.bonusPercent / 100));
    const totalCredits = pkg.credits + bonusCredits;

    // Deduct from bank, add to lifetime spend, add credits
    await sql`
      UPDATE users SET
        xrge_bank_balance = GREATEST(xrge_bank_balance - ${xrgeCost}::numeric, 0),
        xrge_lifetime_spend = xrge_lifetime_spend + ${xrgeCost}::numeric,
        pack_credits = pack_credits + ${totalCredits},
        loyalty_tier = ${tier.id},
        updated_at = now()
      WHERE id = ${userId}
    `;

    const updatedUser = await getBankUser(sql, userId);
    const newBalance = updatedUser ? parseFloat(updatedUser.xrge_bank_balance) : 0;

    // Record bank transaction
    await sql`
      INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, package, credits_awarded, bonus_credits, loyalty_tier_at, note)
      VALUES (
        ${userId},
        'purchase',
        ${(-xrgeCostNum).toString()}::numeric,
        ${newBalance}::numeric,
        ${packageId},
        ${totalCredits},
        ${bonusCredits},
        ${tier.id},
        ${`${packageId} pack: ${pkg.credits} base + ${bonusCredits} bonus (${tier.name} ${tier.bonusPercent}%)`}
      )
    `;

    // Record in main transactions table for billing history
    await sql`
      INSERT INTO transactions (user_id, credits, amount_cents, package, type, payment_method)
      VALUES (${userId}, ${totalCredits}, ${pkg.priceCents}, ${packageId}, 'pack', 'xrge_bank')
    `;

    console.log(
      `[v1/xrge-purchase] ${userId} spent ${xrgeCost} XRGE for ${totalCredits} credits (${tier.name} tier, ${tier.bonusPercent}% bonus)`,
    );

    return res.status(200).json({
      success: true,
      package: packageId,
      xrgeSpent: xrgeCost,
      xrgeRate: config.usdRate,
      baseCredits: pkg.credits,
      bonusCredits,
      bonusPercent: tier.bonusPercent,
      totalCredits,
      loyaltyTier: tier.id,
      loyaltyTierName: tier.name,
      balance: newBalance.toFixed(4),
    });
  } catch (err: any) {
    console.error("[v1/xrge-purchase]", err.message);
    return res.status(500).json({ error: err.message || "Failed to process purchase" });
  }
}
