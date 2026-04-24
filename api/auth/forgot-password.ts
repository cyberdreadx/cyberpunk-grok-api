/**
 * POST /api/auth/forgot-password
 * Sends a 6-digit reset code to the user's email.
 * Rate limited: 3 requests per email per 15 minutes.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { generateVerificationCode, sendPasswordResetEmail } from "../_lib/email";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";
import { ADMIN_EMAIL } from "../_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit by IP — tightened to 3 attempts / 15 min
    const ip = getClientIp(req);
    const ipLimit = await checkRateLimit(ip, "forgot-password", { max: 3, windowSeconds: 900 });
    if (!ipLimit.allowed) {
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }

    // Rate limit by email — 2 attempts / 15 min
    const emailLimit = await checkRateLimit(`email:${normalizedEmail}`, "forgot-password", { max: 2, windowSeconds: 900 });
    if (!emailLimit.allowed) {
      return res.status(429).json({ error: "Too many requests for this email. Try again later." });
    }

    // Block password reset for the admin account via the public endpoint.
    // Admin recovery must go through a manual / out-of-band path to prevent
    // an attacker who compromises the inbox from also taking over admin.
    if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
      console.warn(`[forgot-password] BLOCKED admin reset attempt from IP ${ip}`);
      return res.status(200).json({ message: "If that email exists, a reset code has been sent." });
    }

    const sql = getDb();

    // Check user exists and is verified
    const [user] = await sql`
      SELECT id, email_verified FROM users WHERE email = ${normalizedEmail}
    `;

    // Always return success to prevent email enumeration
    if (!user || !user.email_verified) {
      return res.status(200).json({ message: "If that email exists, a reset code has been sent." });
    }

    // Generate code + expiry (reuse verification_code columns)
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await sql`
      UPDATE users
      SET verification_code = ${code},
          verification_code_expires_at = ${expiresAt},
          verification_attempts = 0,
          updated_at = now()
      WHERE id = ${user.id}
    `;

    await sendPasswordResetEmail(normalizedEmail, code);

    return res.status(200).json({ message: "If that email exists, a reset code has been sent." });
  } catch (err: any) {
    console.error("[forgot-password]", err.message);
    return res.status(500).json({ error: "Failed to process request" });
  }
}
