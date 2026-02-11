/**
 * Simple database-backed rate limiter for serverless functions.
 * Uses a sliding window stored in the rate_limits table.
 */

import type { VercelRequest } from "@vercel/node";
import { getDb } from "./db";

interface RateLimitConfig {
  /** Max requests allowed in the window */
  max: number;
  /** Window size in seconds */
  windowSeconds: number;
}

/** Extract the client IP from a Vercel request. */
export function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0];
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Check and increment the rate limit for a given key + endpoint.
 * Returns { allowed: boolean, remaining: number }.
 */
export async function checkRateLimit(
  key: string,
  endpoint: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number }> {
  const sql = getDb();
  const windowStart = new Date(Date.now() - config.windowSeconds * 1000).toISOString();

  // Try to get existing entry within the current window
  const rows = await sql`
    SELECT count, window_start FROM rate_limits
    WHERE key = ${key} AND endpoint = ${endpoint}
  `;

  if (rows.length === 0) {
    // No entry — create one
    try {
      await sql`
        INSERT INTO rate_limits (key, endpoint, window_start, count)
        VALUES (${key}, ${endpoint}, now(), 1)
      `;
    } catch {
      // Race condition: another request already inserted
      await sql`
        UPDATE rate_limits SET count = count + 1
        WHERE key = ${key} AND endpoint = ${endpoint}
      `;
    }
    return { allowed: true, remaining: config.max - 1 };
  }

  const entry = rows[0];

  // If the window has expired, reset it
  if (new Date(entry.window_start) < new Date(windowStart)) {
    await sql`
      UPDATE rate_limits
      SET count = 1, window_start = now()
      WHERE key = ${key} AND endpoint = ${endpoint}
    `;
    return { allowed: true, remaining: config.max - 1 };
  }

  // Window is still active — check the count
  if (entry.count >= config.max) {
    return { allowed: false, remaining: 0 };
  }

  // Increment
  await sql`
    UPDATE rate_limits SET count = count + 1
    WHERE key = ${key} AND endpoint = ${endpoint}
  `;

  return { allowed: true, remaining: config.max - entry.count - 1 };
}
