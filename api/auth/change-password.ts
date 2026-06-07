/**
 * POST /api/auth/change-password
 * Authenticated password change for a logged-in user. Verifies the current
 * password before setting a new one. (Distinct from the forgot/reset flow,
 * which uses an emailed code.)
 * Rate limited: 10 attempts per IP per 15 minutes.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { getUserFromRequest } from "../_lib/auth";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }
    if (new_password === current_password) {
      return res.status(400).json({ error: "New password must be different from the current one" });
    }

    // Rate limit by IP
    const ip = getClientIp(req);
    const limit = await checkRateLimit(ip, "change-password", { max: 10, windowSeconds: 900 });
    if (!limit.allowed) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }

    const sql = getDb();
    const [user] = await sql`
      SELECT id, email, password_hash FROM users WHERE id = ${auth.userId}::uuid
    `;
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.password_hash) {
      return res.status(400).json({ error: "This account has no password set" });
    }

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await sql`
      UPDATE users SET password_hash = ${newHash}, updated_at = now() WHERE id = ${user.id}
    `;

    return res.status(200).json({ message: "Password changed successfully" });
  } catch (err: any) {
    console.error("[change-password]", err.message);
    return res.status(500).json({ error: "Failed to change password" });
  }
}
