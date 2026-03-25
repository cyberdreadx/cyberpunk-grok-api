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
    if (!email || typeof email !== "string" || !code || typeof code !== "string") {
      return res.status(400).json({ error: "Email and verification code required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (!/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: "Verification code must be 6 digits" });
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
      return res.status(401).json({
        error: "Invalid verification code. Please try again or request a new code.",
      });
    }

    // Success — mark email as verified, clear the code, and grant daily credits
    await sql`
      UPDATE users
      SET email_verified = true,
          verification_code = NULL,
          verification_code_expires_at = NULL,
          verification_attempts = 0,
          daily_credits = 10,
          daily_credits_reset_at = now(),
          updated_at = now()
      WHERE id = ${user.id}
    `;

    // Referral signup reward: grant 3 free credits if this user was referred
    try {
      const [ref] = await sql`
        SELECT id, referrer_id FROM referrals
        WHERE referee_id = ${user.id}::uuid AND referee_signup_reward = false
      `;
      if (ref) {
        await sql`SELECT add_pack_credits(${user.id}::uuid, 3)`;
        await sql`
          UPDATE referrals
          SET referee_verified = true, referee_signup_reward = true
          WHERE id = ${ref.id}::uuid
        `;
        console.log(`[referral] Granted 3 welcome credits to ${user.email} (referred by ${ref.referrer_id})`);
      }
    } catch (refErr: any) {
      // Non-critical — don't block verification if referral reward fails
      console.error("[referral] signup reward failed:", refErr.message);
    }

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
