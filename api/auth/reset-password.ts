/**
 * POST /api/auth/reset-password
 * Validates the 6-digit reset code and sets a new password.
 * Rate limited: 10 attempts per IP per 15 minutes.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, code, new_password } = req.body || {};
    if (!email || !code || !new_password) {
      return res.status(400).json({ error: "Email, code, and new password are required" });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit
    const ip = getClientIp(req);
    const ipLimit = await checkRateLimit(ip, "reset-password", { max: 10, windowSeconds: 900 });
    if (!ipLimit.allowed) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }

    const sql = getDb();

    const [user] = await sql`
      SELECT id, email, verification_code, verification_code_expires_at, verification_attempts
      FROM users
      WHERE email = ${normalizedEmail} AND email_verified = true
    `;

    if (!user) {
      return res.status(400).json({ error: "Invalid email or code" });
    }

    // Check attempts (max 5)
    if ((user.verification_attempts || 0) >= 5) {
      return res.status(400).json({ error: "Too many failed attempts. Request a new code." });
    }

    // Check code exists
    if (!user.verification_code) {
      return res.status(400).json({ error: "No reset code found. Request a new one." });
    }

    // Check expiry
    if (new Date(user.verification_code_expires_at) < new Date()) {
      return res.status(400).json({ error: "Code has expired. Request a new one." });
    }

    // Increment attempts
    await sql`
      UPDATE users SET verification_attempts = COALESCE(verification_attempts, 0) + 1 WHERE id = ${user.id}
    `;

    // Validate code
    if (user.verification_code !== code.trim()) {
      return res.status(400).json({ error: "Invalid code" });
    }

    // Success — update password and clear the code
    const passwordHash = await bcrypt.hash(new_password, 10);
    await sql`
      UPDATE users
      SET password_hash = ${passwordHash},
          verification_code = NULL,
          verification_code_expires_at = NULL,
          verification_attempts = 0,
          updated_at = now()
      WHERE id = ${user.id}
    `;

    // Auto-login: return a JWT
    const token = signToken({ userId: user.id, email: user.email });

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email },
      message: "Password reset successfully",
    });
  } catch (err: any) {
    console.error("[reset-password]", err.message);
    return res.status(500).json({ error: "Failed to reset password" });
  }
}
