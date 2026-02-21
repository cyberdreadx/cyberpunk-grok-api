/**
 * POST /api/xrge-verify
 * Verifies an on-chain XRGE transfer for a pending order and credits the user.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { getXrgeConfig, verifyXrgeTransfer } from "./_lib/xrge";

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

    const { orderId, txHash } = req.body || {};
    if (!orderId || !txHash) {
      return res.status(400).json({ error: "orderId and txHash are required" });
    }

    const sql = getDb();

    // Look up the pending order
    const orders = await sql`
      SELECT id, user_id, package, base_credits, bonus_credits, total_credits,
             amount_cents, xrge_amount, deposit_address, status, tx_hash, expires_at
      FROM xrge_orders
      WHERE id = ${orderId}::uuid
    `;

    if (orders.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orders[0];

    if (order.user_id !== auth.userId) {
      return res.status(403).json({ error: "Order does not belong to this user" });
    }

    if (order.status === "verified") {
      return res.status(200).json({ success: true, credits: order.total_credits, already: true });
    }

    if (order.status !== "pending") {
      return res.status(400).json({ error: `Order is ${order.status}, cannot verify` });
    }

    // Check expiry
    if (new Date(order.expires_at) < new Date()) {
      await sql`UPDATE xrge_orders SET status = 'expired' WHERE id = ${orderId}::uuid`;
      return res.status(400).json({ error: "Order has expired. Please create a new one." });
    }

    // Check if this tx_hash was already used by another order
    const dupes = await sql`
      SELECT id FROM xrge_orders
      WHERE tx_hash = ${txHash.trim().toLowerCase()}
        AND status = 'verified'
        AND id != ${orderId}::uuid
    `;
    if (dupes.length > 0) {
      return res.status(400).json({ error: "This transaction has already been used for another order" });
    }

    // Verify on-chain
    const config = await getXrgeConfig();
    const transfer = await verifyXrgeTransfer(
      txHash,
      order.xrge_amount,
      config.depositAddress,
      config.rpcUrl,
    );

    // Atomic: mark order verified + credit user + insert transaction
    const result = await sql`
      WITH mark AS (
        UPDATE xrge_orders
        SET status = 'verified',
            tx_hash = ${transfer.from ? txHash.trim().toLowerCase() : txHash.trim().toLowerCase()},
            tx_block = ${transfer.blockNumber},
            verified_at = now()
        WHERE id = ${orderId}::uuid
          AND status = 'pending'
        RETURNING id, user_id, total_credits, amount_cents, package
      ), txn AS (
        INSERT INTO transactions (user_id, credits, amount_cents, package, type, payment_method)
        SELECT user_id, total_credits, amount_cents, package, 'pack', 'xrge'
        FROM mark
        RETURNING user_id, credits
      ), upd AS (
        UPDATE users
        SET pack_credits = pack_credits + (SELECT credits FROM txn),
            updated_at = now()
        WHERE id = (SELECT user_id FROM txn)
        RETURNING id
      )
      SELECT
        EXISTS(SELECT 1 FROM mark) AS verified,
        (SELECT credits FROM txn) AS credits
    `;

    const verified = !!result?.[0]?.verified;
    if (!verified) {
      return res.status(400).json({ error: "Order already processed or expired" });
    }

    const creditsAdded = result[0].credits;
    console.log(`[xrge-verify] Added ${creditsAdded} pack credits (incl. 15% bonus) to ${auth.userId} via XRGE tx ${txHash}`);

    return res.status(200).json({
      success: true,
      credits: creditsAdded,
      baseCredits: order.base_credits,
      bonusCredits: order.bonus_credits,
      txHash: txHash.trim().toLowerCase(),
    });
  } catch (err: any) {
    console.error("[xrge-verify]", err.message);
    // Return user-friendly error messages from the verification lib
    return res.status(400).json({ error: err.message || "Failed to verify XRGE transfer" });
  }
}
