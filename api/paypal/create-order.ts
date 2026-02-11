/**
 * POST /api/paypal/create-order — Create a PayPal order for a credit pack.
 * Returns { orderId } for the frontend PayPal buttons.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "../_lib/auth";
import { createPayPalOrder } from "../_lib/paypal";
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
  const packageId = body.package as string;
  const pkg = PACKAGES[packageId];
  if (!pkg) return res.status(400).json({ error: `Unknown package: ${packageId}` });

  try {
    const orderId = await createPayPalOrder({
      amountDollars: (pkg.priceCents / 100).toFixed(2),
      packageId,
      credits: pkg.credits,
      userId: auth.userId,
    });
    return res.status(200).json({ orderId });
  } catch (err: any) {
    console.error("[paypal/create-order]", err.message);
    return res.status(500).json({ error: err.message || "Failed to create order" });
  }
}
