import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getDb();
    const result = await sql`DELETE FROM stories WHERE expires_at < now()`;
    console.log("[cron] Cleaned up expired stories");
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[cron] story cleanup error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
