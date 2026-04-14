/**
 * POST /api/xrge-checkout
 * Creates a pending XRGE payment order for a credit pack.
 * Returns the deposit address, XRGE amount to send, and order ID.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { getXrgeConfig, centsToXrge } from "./_lib/xrge";
import { getTierForSpend } from "./v1/_lib/xrge-bank";

const PACKAGES: Record<string, { credits: number; priceCents: number }> = {
  starter: { credits: 50, priceCents: 500 },
  pro: { credits: 175, priceCents: 1500 },
  mega: { credits: 450, priceCents: 3500 },
  ultra: { credits: 2200, priceCents: 15000 },
  enterprise: { credits: 4500, priceCents: 30000 },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { package: packageId } = req.body || {};
    const pkg = PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: "Unknown package: " + packageId });

    const sql = getDb();
    const config = await getXrgeConfig();
    let xrgeAmount = centsToXrge(pkg.priceCents, config.usdRate);

    // Check for active flash sale
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
    if (activeSale) {
      const applicablePackages = activeSale.packages;
      if (!applicablePackages || applicablePackages.includes(packageId)) {
        flashSaleId = activeSale.id;
        flashDiscountPercent = activeSale.discount_percent;
        flashBonusPercent = activeSale.bonus_credits_percent || 0;
        // Apply discount to XRGE price
        const discountedCents = Math.round(pkg.priceCents * (1 - flashDiscountPercent / 100));
        xrgeAmount = centsToXrge(discountedCents, config.usdRate);
      }
    }

    // Loyalty-tier-aware bonus: look up user's lifetime XRGE spend
    const [spendRow] = await sql`
      SELECT xrge_lifetime_spend FROM users WHERE id = ${auth.userId}::uuid
    `;
    const lifetimeSpend = parseFloat(spendRow?.xrge_lifetime_spend || "0");
    const tier = getTierForSpend(lifetimeSpend);
    const loyaltyBonusCredits = Math.floor(pkg.credits * (tier.bonusPercent / 100));
    const flashBonusCredits = Math.floor(pkg.credits * (flashBonusPercent / 100));
    const bonusCredits = loyaltyBonusCredits + flashBonusCredits;
    const totalCredits = pkg.credits + bonusCredits;

    // Expire any existing pending orders for this user+package
    await sql`
      UPDATE xrge_orders
      SET status = 'cancelled'
      WHERE user_id = ${auth.userId}::uuid
        AND status = 'pending'
    `;

    // Create new pending order
    const rows = await sql`
      INSERT INTO xrge_orders (user_id, package, base_credits, bonus_credits, total_credits, amount_cents, xrge_amount, xrge_rate, deposit_address)
      VALUES (
        ${auth.userId}::uuid,
        ${packageId},
        ${pkg.credits},
        ${bonusCredits},
        ${totalCredits},
        ${pkg.priceCents},
        ${xrgeAmount},
        ${config.usdRate.toString()},
        ${config.depositAddress}
      )
      RETURNING id, xrge_amount, deposit_address, expires_at
    `;

    const order = rows[0];

    // Increment flash sale usage if applicable
    if (flashSaleId) {
      await sql`UPDATE xrge_flash_sales SET uses = uses + 1 WHERE id = ${flashSaleId}::uuid`;
    }

    return res.status(200).json({
      orderId: order.id,
      xrgeAmount: order.xrge_amount,
      depositAddress: order.deposit_address,
      expiresAt: order.expires_at,
      baseCredits: pkg.credits,
      bonusCredits,
      loyaltyBonusCredits,
      flashBonusCredits,
      totalCredits,
      packageName: packageId.toUpperCase(),
      bonusPercent: tier.bonusPercent,
      loyaltyTier: tier.id,
      loyaltyTierName: tier.name,
      flashSale: flashSaleId ? {
        id: flashSaleId,
        discountPercent: flashDiscountPercent,
        bonusCreditsPercent: flashBonusPercent,
      } : null,
    });
  } catch (err: any) {
    console.error("[xrge-checkout]", err.message);
    return res.status(500).json({ error: "Failed to create order" });
  }
}
