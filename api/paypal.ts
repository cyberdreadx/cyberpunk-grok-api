/**
 * POST /api/paypal -- Unified PayPal handler for credit pack purchases.
 * Routes on body.action:
 *   "create"  -> create a PayPal order (returns { orderId })
 *   "capture" -> capture an approved order and add credits
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { createPayPalOrder, capturePayPalOrder } from "./_lib/paypal";
import { getDb } from "./_lib/db";

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
  const action = body.action as string;

  if (action === "create") {
    return handleCreate(res, auth, body);
  } else if (action === "capture") {
    return handleCapture(res, auth, body);
  } else {
    return res.status(400).json({ error: "Missing or invalid action. Expected create or capture." });
  }
}

async function handleCreate(
  res: VercelResponse,
  auth: { userId: string },
  body: any
) {
  const packageId = body.package as string;
  const pkg = PACKAGES[packageId];
  if (!pkg) return res.status(400).json({ error: "Unknown package: " + packageId });

  try {
    const orderId = await createPayPalOrder({
      amountDollars: (pkg.priceCents / 100).toFixed(2),
      packageId,
      credits: pkg.credits,
      userId: auth.userId,
    });
    return res.status(200).json({ orderId });
  } catch (err: any) {
    console.error("[paypal/create]", err.message);
    return res.status(500).json({ error: err.message || "Failed to create order" });
  }
}

async function handleCapture(
  res: VercelResponse,
  auth: { userId: string },
  body: any
) {
  const orderId = body.orderID || body.orderId;
  if (!orderId) return res.status(400).json({ error: "Missing orderID" });

  const sql = getDb();

  try {
    const { captureId, customId } = await capturePayPalOrder(orderId);

    let userId: string;
    let packageId: string;
    let credits: number;
    try {
      const meta = JSON.parse(customId || "{}") as { user_id?: string; package?: string; credits?: number };
      userId = meta.user_id || "";
      packageId = meta.package || "";
      credits = meta.credits || 0;
    } catch {
      return res.status(400).json({ error: "Invalid capture metadata" });
    }

    if (!userId || !packageId || credits <= 0) {
      return res.status(400).json({ error: "Invalid capture metadata" });
    }

    if (userId !== auth.userId) {
      return res.status(403).json({ error: "Order does not belong to this user" });
    }

    const pkg = PACKAGES[packageId];
    const amountCents = pkg ? pkg.priceCents : 0;

    // Atomic + idempotent: insert transaction first, then add credits only if inserted.
    const rows = await sql`
      WITH ins AS (
        INSERT INTO transactions (user_id, credits, amount_cents, paypal_capture_id, package, type)
        VALUES (${userId}::uuid, ${credits}, ${amountCents}, ${captureId}, ${packageId}, 'pack')
        ON CONFLICT DO NOTHING
        RETURNING user_id, credits
      ), upd AS (
        UPDATE users
        SET pack_credits = pack_credits + (SELECT credits FROM ins),
            updated_at = now()
        WHERE id = ${userId}::uuid
          AND EXISTS (SELECT 1 FROM ins)
        RETURNING id
      )
      SELECT EXISTS(SELECT 1 FROM ins) AS inserted
    `;

    const inserted = !!rows?.[0]?.inserted;
    if (!inserted) {
      return res.status(200).json({ success: true, credits: "already_added" });
    }
    console.log("[paypal/capture] Added " + credits + " pack credits to " + userId);

    return res.status(200).json({ success: true, credits });
  } catch (err: any) {
    console.error("[paypal/capture]", err.message);
    return res.status(500).json({ error: err.message || "Failed to capture order" });
  }
}
