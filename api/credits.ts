import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    await checkRateLimit(auth.userId, "credits", { max: 60, windowSeconds: 60 });

    const sql = getDb();
    const rows = await sql`
      SELECT sub_credits, pack_credits, subscription_tier, subscription_renews_at, subscription_cancel_at
      FROM users
      WHERE id = ${auth.userId}
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json(rows[0]);
  } catch (err: any) {
    console.error("[credits]", err.message);
    return res.status(500).json({ error: "Failed to fetch credits" });
  }
}
