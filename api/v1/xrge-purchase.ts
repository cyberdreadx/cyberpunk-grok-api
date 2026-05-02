/**
 * POST /api/v1/xrge-purchase
 * Purchase credits using XRGE from the user's bank balance.
 *
 * Body: { package: "starter" | "pro" | "mega" | "ultra" | "enterprise" }
 * Auth: X-API-Key or Authorization: Bearer JWT.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { getXrgeConfig, centsToXrge } from "../_lib/xrge";
import { getBankUser, getTierForSpend, refreshLoyaltyTier, CREDIT_PACKAGES } from "./_lib/xrge-bank";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiKeyAuth = await getUserFromApiKey(req);
    const jwtAuth = !apiKeyAuth ? getUserFromRequest(req) : null;
    const userId = apiKeyAuth?.userId || jwtAuth?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { package: packageId } = req.body || {};
    const pkg = CREDIT_PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: "Unknown package: " + packageId });

    const sql = getDb();
    const config = await getXrgeConfig();

    // Check for active flash sale (mirrors api/xrge-checkout.ts)
    let flashSaleId: string | null = null;
    let flashDiscountPercent = 0;
    let flashBonusPercent = 0;
    const [activeSale] = await sql`
      SELECT id, discount_percent, bonus_credits_percent, packages
      FROM xrge_flash_sales
      WHERE active = true AND starts_at <= now() AND ends_at > now()
        AND (max_uses IS NULL OR uses < max_uses)
      ORDER BY discount_percent DESC
      LIMIT 1
    `;
    let priceCents = pkg.priceCents;
    if (activeSale) {
      const applicablePackages = activeSale.packages;
      if (!applicablePackages || applicablePackages.includes(packageId)) {
        flashSaleId = activeSale.id;
        flashDiscountPercent = activeSale.discount_percent;
        flashBonusPercent = activeSale.bonus_credits_percent || 0;
        priceCents = Math.round(pkg.priceCents * (1 - flashDiscountPercent / 100));
      }
    }

    const xrgeCost = parseFloat(centsToXrge(priceCents, config.usdRate));

    const user = await getBankUser(sql, userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.bankBalance < xrgeCost) {
      return res.status(400).json({
        error: "Insufficient XRGE balance",
        required: xrgeCost,
        available: user.bankBalance,
      });
    }

    // Loyalty tier + flash sale bonus credits
    const tier = getTierForSpend(user.lifetimeSpend);
    const loyaltyBonusCredits = Math.floor(pkg.credits * (tier.bonusPercent / 100));
    const flashBonusCredits = Math.floor(pkg.credits * (flashBonusPercent / 100));
    const bonusCredits = loyaltyBonusCredits + flashBonusCredits;
    const totalCredits = pkg.credits + bonusCredits;

    // Atomic: deduct XRGE, credit user, record txn + transaction
    const [result] = await sql`
      WITH deduct AS (
        UPDATE users
        SET xrge_bank_balance = xrge_bank_balance - ${xrgeCost}::numeric,
            xrge_lifetime_spend = xrge_lifetime_spend + ${xrgeCost}::numeric,
            pack_credits = pack_credits + ${totalCredits},
            updated_at = now()
        WHERE id = ${userId} AND xrge_bank_balance >= ${xrgeCost}::numeric
        RETURNING id, xrge_bank_balance
      ), bank_txn AS (
        INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, metadata)
        SELECT id, 'purchase', ${xrgeCost}::numeric, xrge_bank_balance,
               ${JSON.stringify({ package: packageId, credits: totalCredits, baseCredits: pkg.credits, bonusCredits, flashSaleId, flashDiscountPercent, flashBonusPercent })}::jsonb
        FROM deduct
        RETURNING user_id
      ), credit_txn AS (
        INSERT INTO transactions (user_id, credits, amount_cents, package, type, payment_method)
        SELECT id, ${totalCredits}, ${priceCents}, ${packageId}, 'pack', 'xrge-bank'
        FROM deduct
        RETURNING user_id
      )
      SELECT
        (SELECT xrge_bank_balance FROM deduct) AS new_balance,
        EXISTS(SELECT 1 FROM deduct) AS success
    `;

    if (!result?.success) {
      return res.status(400).json({ error: "Insufficient balance (race condition)" });
    }

    await refreshLoyaltyTier(sql, userId);

    const newBalance = parseFloat(result.new_balance);

    console.log(`[xrge-purchase] ${userId} bought ${totalCredits} credits (${packageId}) for ${xrgeCost} XRGE`);

    return res.status(200).json({
      success: true,
      package: packageId,
      baseCredits: pkg.credits,
      bonusCredits,
      totalCredits,
      xrgeSpent: xrgeCost,
      newBankBalance: newBalance,
      loyaltyTier: tier.id,
      loyaltyTierName: tier.name,
      bonusPercent: tier.bonusPercent,
    });
  } catch (err: any) {
    console.error("[xrge-purchase]", err.message);
    return res.status(500).json({ error: "Purchase failed" });
  }
}
