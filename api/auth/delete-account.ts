/**
 * POST /api/auth/delete-account
 * Permanently deletes the user's account. Requires password confirmation.
 * Cancels any active Stripe subscription before deletion.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { getDb } from "../_lib/db";
import { getUserFromRequest } from "../_lib/auth";
import { deleteBlobs, isVercelBlobUrl } from "../_lib/blob";
import { isR2Url, r2KeyFromUrl, deleteR2Objects, deleteR2Prefix } from "../_lib/r2";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: "Password is required to delete your account" });
    }

    const sql = getDb();

    // Verify password
    const [user] = await sql`
      SELECT id, email, password_hash, stripe_customer_id, subscription_tier
      FROM users WHERE id = ${auth.userId}
    `;
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Incorrect password" });

    // Cancel active Stripe subscription if exists
    if (user.stripe_customer_id && user.subscription_tier) {
      try {
        const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
        if (STRIPE_KEY) {
          const stripe = new Stripe(STRIPE_KEY);
          const subs = await stripe.subscriptions.list({
            customer: user.stripe_customer_id,
            status: "active",
            limit: 5,
          });
          for (const sub of subs.data) {
            await stripe.subscriptions.cancel(sub.id);
          }
        }
      } catch (err: any) {
        console.warn("[delete-account] Failed to cancel Stripe sub:", err.message);
        // Continue with deletion anyway
      }
    }

    // Delete user (cascades to referrals, transactions, etc. due to ON DELETE CASCADE if set,
    // otherwise we clean up manually)
    await sql`DELETE FROM transactions WHERE user_id = ${user.id}`;
    await sql`DELETE FROM referrals WHERE referrer_id = ${user.id} OR referee_id = ${user.id}`;
    await sql`DELETE FROM users WHERE id = ${user.id}`;

    console.log(`[delete-account] Deleted user ${user.email} (${user.id})`);

    return res.status(200).json({ message: "Account deleted successfully" });
  } catch (err: any) {
    console.error("[delete-account]", err.message);
    return res.status(500).json({ error: "Failed to delete account" });
  }
}
