import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: "Email and verification code required" });
    }

    const sql = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    const rows = await sql`
      SELECT id, email, email_verified, verification_code, verification_code_expires_at
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

    // Check code matches
    if (user.verification_code !== code.trim()) {
      return res.status(401).json({ error: "Invalid verification code" });
    }

    // Check code hasn't expired
    if (new Date(user.verification_code_expires_at) < new Date()) {
      return res.status(410).json({ error: "Verification code has expired. Please request a new one." });
    }

    // Mark email as verified and clear the code
    await sql`
      UPDATE users
      SET email_verified = true,
          verification_code = NULL,
          verification_code_expires_at = NULL,
          updated_at = now()
      WHERE id = ${user.id}
    `;

    // Sign JWT and return — user is now logged in
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
