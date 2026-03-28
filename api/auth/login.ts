import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Rate limit: 10 login attempts per IP per 15 minutes
    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(ip, "login", { max: 10, windowSeconds: 900 });
    if (!allowed) {
      return res.status(429).json({ error: "Too many login attempts. Please try again later." });
    }

    const sql = getDb();
    const rows = await sql`
      SELECT id, email, password_hash, email_verified
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
    `;

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken({ userId: user.id, email: user.email });

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email },
      email_verified: !!user.email_verified,
    });
  } catch (err: any) {
    console.error("[login]", err.message);
    return res.status(500).json({ error: "Login failed" });
  }
}
