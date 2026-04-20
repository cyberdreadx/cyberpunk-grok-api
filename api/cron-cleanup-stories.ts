import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { deleteBlobs } from "./_lib/blob";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getDb();
    // Capture media URLs of expiring stories so we can purge their blobs.
    const expiring = await sql`SELECT media_url FROM stories WHERE expires_at < now()`;
    // First delete views for expired stories
    await sql`DELETE FROM story_views WHERE story_id IN (SELECT id FROM stories WHERE expires_at < now())`;
    const result = await sql`DELETE FROM stories WHERE expires_at < now()`;

    // Best-effort blob cleanup (won't fail the cron if it errors)
    const urls = expiring.map((r: any) => r.media_url).filter(Boolean);
    if (urls.length > 0) {
      await deleteBlobs(urls).catch((e) => console.warn("[cron] blob cleanup error:", e?.message));
    }

    console.log("[cron] Cleaned up expired stories, deleted:", result.count, "blobs:", urls.length);
    return res.status(200).json({ ok: true, deleted: result.count, blobsDeleted: urls.length });
  } catch (err: any) {
    console.error("[cron] story cleanup error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
