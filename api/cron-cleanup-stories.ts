import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { deleteMediaUrls } from "./_lib/media-delete";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getDb();
    // Capture media URLs of expiring stories so we can purge their files.
    const expiring = await sql`SELECT media_url, preview_url FROM stories WHERE expires_at < now()`;
    // First delete views for expired stories
    await sql`DELETE FROM story_views WHERE story_id IN (SELECT id FROM stories WHERE expires_at < now())`;
    const result = await sql`DELETE FROM stories WHERE expires_at < now()`;

    // Best-effort media cleanup — Blob AND R2 (won't fail the cron if it errors)
    const urls = expiring.flatMap((r: any) => [r.media_url, r.preview_url]).filter(Boolean);
    let purged = { blob: { deleted: 0 }, r2: { deleted: 0 } } as Awaited<ReturnType<typeof deleteMediaUrls>>;
    if (urls.length > 0) {
      purged = await deleteMediaUrls(urls).catch((e) => {
        console.warn("[cron] story media cleanup error:", e?.message);
        return { blob: { found: 0, deleted: 0, failed: 0 }, r2: { found: 0, deleted: 0, failed: 0 }, skipped: 0 };
      });
    }

    console.log(
      `[cron] Cleaned up expired stories: ${result.count} rows, ` +
      `${purged.blob.deleted} blobs, ${purged.r2.deleted} R2 objects`,
    );
    return res.status(200).json({
      ok: true,
      deleted: result.count,
      blobsDeleted: purged.blob.deleted,
      r2Deleted: purged.r2.deleted,
    });
  } catch (err: any) {
    console.error("[cron] story cleanup error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
