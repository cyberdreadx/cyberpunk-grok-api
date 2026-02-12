import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * /api/health — Lightweight health check.
 * Only exposes status: ok/degraded. No env var names, no internal details.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  let dbOk = false;
  try {
    const { neon } = require("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL || "");
    await sql`SELECT 1 as ok`;
    dbOk = true;
  } catch {
    // DB unreachable
  }

  const status = dbOk ? "ok" : "degraded";
  return res.status(dbOk ? 200 : 503).json({ status });
}
