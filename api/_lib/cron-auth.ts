/**
 * Shared auth gate for /api/cron-* endpoints.
 *
 * The local scheduler (server/index.ts) sends `Authorization: Bearer
 * <CRON_SECRET>` on every cron hit; nothing else should be able to trigger
 * these handlers. When CRON_SECRET is unset (dev), the gate is open.
 *
 * Usage, first line of the handler:
 *   if (!requireCronAuth(req, res)) return;
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export function requireCronAuth(req: VercelRequest, res: VercelResponse): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const bearer = (req.headers.authorization || "").toString().replace(/^Bearer\s+/i, "");
  if (bearer === secret) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}
