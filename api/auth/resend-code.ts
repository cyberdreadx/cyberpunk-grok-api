import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { generateVerificationCode, sendVerificationEmail } from "../_lib/email";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const sql = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    const rows = await sql`
      SELECT id, email_verified FROM users WHERE email = ${normalizedEmail}
    `;

    if (rows.length === 0) {
      // Don't reveal whether an account exists
      return res.status(200).json({ message: "If an account exists, a new code has been sent." });
    }

    const user = rows[0];

    if (user.email_verified) {
      return res.status(400).json({ error: "Email is already verified" });
    }

    // Generate a fresh code
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await sql`
      UPDATE users
      SET verification_code = ${code},
          verification_code_expires_at = ${expiresAt},
          updated_at = now()
      WHERE id = ${user.id}
    `;

    await sendVerificationEmail(normalizedEmail, code);

    return res.status(200).json({ message: "If an account exists, a new code has been sent." });
  } catch (err: any) {
    console.error("[resend-code]", err.message);
    return res.status(500).json({ error: "Failed to resend code" });
  }
}
