import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";

const MAX_ATTEMPTS = 5;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: "Email and verification code required" });
    }

    // Rate limit: 10 verify attempts per IP per 15 minutes
    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(ip, "verify", { max: 10, windowSeconds: 900 });
    if (!allowed) {
      return res.status(429).json({ error: "Too many attempts. Please try again later." });
    }

    const sql = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    const rows = await sql`
      SELECT id, email, email_verified, verification_code, verification_code_expires_at, verification_attempts
      FROM users
      WHERE email = ${normalizedEmail}
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "No account found with this email" });
    }

    const user = rows[0];

    if (user.email_verified) {
      return res.status(400).json({ error: "Email is already verified" });
    }

    // Check if max attempts exceeded — code is burned
    if ((user.verification_attempts || 0) >= MAX_ATTEMPTS) {
      // Invalidate the code
      await sql`
        UPDATE users
        SET verification_code = NULL,
            verification_code_expires_at = NULL,
            verification_attempts = 0,
            updated_at = now()
        WHERE id = ${user.id}
      `;
      return res.status(429).json({
        error: "Too many failed attempts. Please request a new code.",
      });
    }

    // Check code hasn't expired
    if (new Date(user.verification_code_expires_at) < new Date()) {
      return res.status(410).json({ error: "Verification code has expired. Please request a new one." });
    }

    // Check code matches
    if (user.verification_code !== code.trim()) {
      // Increment attempts
      await sql`
        UPDATE users
        SET verification_attempts = COALESCE(verification_attempts, 0) + 1,
            updated_at = now()
        WHERE id = ${user.id}
      `;
      const attemptsLeft = MAX_ATTEMPTS - (user.verification_attempts || 0) - 1;
      return res.status(401).json({
        error: `Invalid verification code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining.`,
      });
    }

    // Success — mark email as verified and clear the code
    await sql`
      UPDATE users
      SET email_verified = true,
          verification_code = NULL,
          verification_code_expires_at = NULL,
          verification_attempts = 0,
          updated_at = now()
      WHERE id = ${user.id}
    `;

    const token = signToken({ userId: user.id, email: user.email });

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err: any) {
    console.error("[verify]", err.message);
    return res.status(500).json({ error: "Verification failed" });
  }
}
