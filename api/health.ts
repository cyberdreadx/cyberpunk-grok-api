import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const checks: Record<string, string> = {
    status: "ok",
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "MISSING",
    JWT_SECRET: process.env.JWT_SECRET ? "set" : "MISSING",
    XAI_API_KEY: process.env.XAI_API_KEY ? "set" : "MISSING",
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? "set" : "MISSING",
  };

  // Test DB connection
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL || "");
    const result = await sql`SELECT 1 as ok`;
    checks.database = "connected";
  } catch (err: any) {
    checks.database = `error: ${err.message}`;
  }

  // Test JWT import
  try {
    const jwt = await import("jsonwebtoken");
    checks.jwt = typeof jwt.sign === "function" ? "ok" : `unexpected: ${typeof jwt.sign}`;
  } catch (err: any) {
    checks.jwt = `error: ${err.message}`;
  }

  return res.status(200).json(checks);
}
