import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
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

    // Block unverified accounts — tell frontend to show verification step
    if (!user.email_verified) {
      return res.status(403).json({
        error: "Email not verified. Please check your inbox for a verification code.",
        needsVerification: true,
        email: user.email,
      });
    }

    const token = signToken({ userId: user.id, email: user.email });

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err: any) {
    console.error("[login]", err.message);
    return res.status(500).json({ error: "Login failed" });
  }
}
