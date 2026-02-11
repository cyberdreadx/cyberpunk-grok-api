/**
 * POST /api/paypal/capture-order — Capture a PayPal order after user approval.
 * Idempotent: duplicate capture IDs return success without double-crediting.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "../_lib/auth";
import { capturePayPalOrder } from "../_lib/paypal";
import { getDb } from "../_lib/db";

const PACKAGES: Record<string, { credits: number; priceCents: number }> = {
  starter: { credits: 50, priceCents: 500 },
  pro: { credits: 175, priceCents: 1500 },
  mega: { credits: 450, priceCents: 3500 },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const orderId = body.orderID ?? body.orderId;
  if (!orderId) return res.status(400).json({ error: "Missing orderID" });

  const sql = getDb();

  try {
    const { captureId, customId } = await capturePayPalOrder(orderId);

    // Idempotency: skip if we already processed this capture
    const existing = await sql`
      SELECT id FROM transactions WHERE paypal_capture_id = ${captureId} LIMIT 1
    `;
    if (existing.length > 0) {
      return res.status(200).json({ success: true, credits: "already_added" });
    }

    let userId: string;
    let packageId: string;
    let credits: number;
    try {
      const meta = JSON.parse(customId || "{}") as { user_id?: string; package?: string; credits?: number };
      userId = meta.user_id ?? "";
      packageId = meta.package ?? "";
      credits = meta.credits ?? 0;
    } catch {
      return res.status(400).json({ error: "Invalid capture metadata" });
    }

    if (!userId || !packageId || credits <= 0) {
      return res.status(400).json({ error: "Invalid capture metadata" });
    }

    // Verify the authenticated user matches the order
    if (userId !== auth.userId) {
      return res.status(403).json({ error: "Order does not belong to this user" });
    }

    const pkg = PACKAGES[packageId];
    const amountCents = pkg?.priceCents ?? 0;

    await sql`SELECT add_pack_credits(${userId}::uuid, ${credits})`;
    await sql`
      INSERT INTO transactions (user_id, credits, amount_cents, paypal_capture_id, package, type)
      VALUES (${userId}::uuid, ${credits}, ${amountCents}, ${captureId}, ${packageId}, 'pack')
    `;
    console.log(`[paypal/capture] Added ${credits} pack credits to ${userId} via PayPal`);

    return res.status(200).json({ success: true, credits });
  } catch (err: any) {
    console.error("[paypal/capture-order]", err.message);
    return res.status(500).json({ error: err.message || "Failed to capture order" });
  }
}
