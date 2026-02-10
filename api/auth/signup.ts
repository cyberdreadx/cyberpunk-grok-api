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
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const sql = getDb();
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user — unique constraint on email handles duplicates
    let rows: any[];
    try {
      rows = await sql`
        INSERT INTO users (email, password_hash)
        VALUES (${email.toLowerCase().trim()}, ${passwordHash})
        RETURNING id, email
      `;
    } catch (err: any) {
      if (err.message?.includes("unique") || err.code === "23505") {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      throw err;
    }

    const user = rows[0];
    const token = signToken({ userId: user.id, email: user.email });

    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err: any) {
    console.error("[signup]", err.message);
    return res.status(500).json({ error: "Failed to create account" });
  }
}
