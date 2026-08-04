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

/**
 * Extract the client IP.
 *
 * The FIRST X-Forwarded-For entry is attacker-controlled: a client can send its
 * own X-Forwarded-For and nginx ($proxy_add_x_forwarded_for) appends the real
 * peer rather than replacing it. Taking [0] therefore let anyone land in a fresh
 * rate-limit bucket per request, which removed the ceiling on login/signup/
 * password-reset attempts. Prefer X-Real-IP (our nginx overwrites it with
 * $remote_addr), then the LAST XFF hop, then the socket.
 */
export function getClientIp(req: VercelRequest): string {
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

  const forwarded = req.headers["x-forwarded-for"];
  const chain = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  if (typeof chain === "string" && chain.trim()) {
    const hops = chain.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
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

  /*
   * Single-statement upsert: read-then-write let a concurrent burst all observe
   * the same count and all pass, so no limit in the app actually bounded a
   * parallel attacker. The window reset and the increment now happen inside one
   * atomic UPDATE, and the resulting count decides the verdict.
   */
  const rows = await sql`
    INSERT INTO rate_limits (key, endpoint, window_start, count)
    VALUES (${key}, ${endpoint}, now(), 1)
    ON CONFLICT (key, endpoint) DO UPDATE
    SET count = CASE
          WHEN rate_limits.window_start < now() - make_interval(secs => ${config.windowSeconds}) THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start < now() - make_interval(secs => ${config.windowSeconds}) THEN now()
          ELSE rate_limits.window_start
        END
    RETURNING count
  ` as any[];

  const count = Number(rows[0]?.count ?? 1);
  if (count > config.max) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: Math.max(0, config.max - count) };
}
