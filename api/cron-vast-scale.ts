/**
 * Every minute: rent / retire Vast.ai overflow machines (api/_lib/vast.ts).
 * A no-op until VAST_API_KEY and VAST_WORKER_SECRET are set.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireCronAuth } from "./_lib/cron-auth";
import { scaleTick } from "./_lib/vast";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronAuth(req, res)) return;
  try {
    return res.status(200).json(await scaleTick());
  } catch (e: any) {
    console.error("[cron-vast-scale]", e?.message);
    return res.status(500).json({ error: e?.message });
  }
}
