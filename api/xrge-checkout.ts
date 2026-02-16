/**
 * POST /api/xrge-checkout
 * Creates a pending XRGE payment order for a credit pack.
 * Returns the deposit address, XRGE amount to send, and order ID.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { getXrgeConfig, centsToXrge } from "./_lib/xrge";

const PACKAGES: Record<string, { credits: number; priceCents: number }> = {
  starter:    { credits: 50,   priceCents: 500 },
  pro:        { credits: 175,  priceCents: 1500 },
  mega:       { credits: 450,  priceCents: 3500 },
  ultra:      { credits: 1800, priceCents: 15000 },
  enterprise: { credits: 4000, priceCents: 30000 },
};

const BONUS_MULTIPLIER = 0.15; // 15% bonus for XRGE payments

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

    const config = await getXrgeConfig();
    const xrgeAmount = centsToXrge(pkg.priceCents, config.usdRate);
    const bonusCredits = Math.floor(pkg.credits * BONUS_MULTIPLIER);
    const totalCredits = pkg.credits + bonusCredits;

    // Expire any existing pending orders for this user+package
    const sql = getDb();
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

    return res.status(200).json({
      orderId: order.id,
      xrgeAmount: order.xrge_amount,
      depositAddress: order.deposit_address,
      expiresAt: order.expires_at,
      baseCredits: pkg.credits,
      bonusCredits,
      totalCredits,
      packageName: packageId.toUpperCase(),
      bonusPercent: 15,
    });
  } catch (err: any) {
    console.error("[xrge-checkout]", err.message);
    return res.status(500).json({ error: err.message || "Failed to create XRGE order" });
  }
}
