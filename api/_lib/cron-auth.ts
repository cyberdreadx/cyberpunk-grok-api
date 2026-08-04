/**
 * Shared auth gate for /api/cron-* endpoints.
 *
 * The local scheduler (server/index.ts) sends `Authorization: Bearer
 * <CRON_SECRET>` on every cron hit; nothing else should be able to trigger
 * these handlers — they perform bulk media deletion.
 *
 * Fails CLOSED when CRON_SECRET is missing: previously a dropped env var
 * silently turned destructive endpoints into unauthenticated ones. Matches the
 * money-touching crons, which already fail closed.
 *
 * Usage, first line of the handler:
 *   if (!requireCronAuth(req, res)) return;
 */
import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requireCronAuth(req: VercelRequest, res: VercelResponse): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron-auth] CRON_SECRET is not set — refusing cron request");
    res.status(503).json({ error: "Cron not configured" });
    return false;
  }
  const bearer = (req.headers.authorization || "").toString().replace(/^Bearer\s+/i, "");
  if (bearer && safeEqual(bearer, secret)) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}
