import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";
import { applyCors } from "../_lib/cors";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";
import { clearEmailVerifiedCache } from "../_lib/emailVerifiedGate";
import { grantStarterCredits } from "../_lib/starterGrant";

const MAX_ATTEMPTS = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
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
      SELECT id, email, email_verified, verification_code, verification_code_expires_at, verification_attempts, device_fingerprint
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

    // Success — mark email as verified and clear the code.
    await sql`
      UPDATE users
      SET email_verified = true,
          verification_code = NULL,
          verification_code_expires_at = NULL,
          verification_attempts = 0,
          updated_at = now()
      WHERE id = ${user.id}
    `;

    // Generation is gated on this flag and the gate caches for 30s — drop the
    // entry now so someone who verifies isn't told to verify again.
    clearEmailVerifiedCache(user.id);

    // One-time starter grant, claimed per DEVICE rather than per account —
    // see _lib/starterGrant. Disabled by default; admin toggles it under
    // free-credit sources.
    const starter = await grantStarterCredits(sql, user.id, user.device_fingerprint);
    if (starter.granted) {
      console.log(`[starter-grant] +${starter.credits} to ${user.id}`);
    }

    // Beyond the starter grant, free credits are earn-only (2026-07): they come
    // exclusively from /api/earn engagement rewards.
    // Still mark the referral as verified so referrer stats stay accurate.
    try {
      await sql`
        UPDATE referrals SET referee_verified = true
        WHERE referee_id = ${user.id}::uuid AND referee_verified = false
      `;
    } catch (refErr: any) {
      console.error("[referral] verify flag failed:", refErr.message);
    }

    const token = signToken({ userId: user.id, email: user.email });

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email },
      // Let the UI tell them they got something, rather than dropping them
      // into an app whose balance silently changed.
      starterCredits: starter.granted ? starter.credits : 0,
    });
  } catch (err: any) {
    console.error("[verify]", err.message);
    return res.status(500).json({ error: "Verification failed" });
  }
}
