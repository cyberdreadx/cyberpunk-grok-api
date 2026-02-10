import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromRequest } from "../_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const sql = getDb();
    const rows = await sql`
      SELECT id, email, sub_credits, pack_credits, subscription_tier, subscription_renews_at
      FROM users
      WHERE id = ${auth.userId}
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = rows[0];
    return res.status(200).json({
      id: user.id,
      email: user.email,
      sub_credits: user.sub_credits,
      pack_credits: user.pack_credits,
      subscription_tier: user.subscription_tier,
      subscription_renews_at: user.subscription_renews_at,
    });
  } catch (err: any) {
    console.error("[me]", err.message);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
}
