/**
 * Generate the missing first-frame previews for video feed posts.
 *
 * All 223 video posts have preview_image_url NULL, because feed POST only
 * calls ensurePreviewForUrl() when a post is locked. Everything else fell back
 * to client-side canvas extraction, which downloads the whole video per tile
 * and times out — hence "you can't see video previews in grid mode".
 *
 *   node --env-file=.env --import tsx scripts/backfill-video-previews.mts [--limit N] [--dry]
 *
 * Idempotent: only touches rows where preview_image_url IS NULL, and
 * ensurePreviewForUrl reuses an existing -preview.webp companion when one is
 * already on R2. Safe to re-run after a partial pass.
 */
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { ensurePreviewForUrl } from "/home/neon/cyberpunk-grok-api/api/_lib/ensure-preview.ts";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : 0;
const CONCURRENCY = 3; // ffmpeg + a 100MB fetch each; don't saturate the box

const sql = getDb();
const VID = "[.](mp4|webm|mov|m4v)([?]|$)";

const rows = await sql`
  SELECT id, image_url FROM feed_posts
  WHERE image_url ~* ${VID} AND preview_image_url IS NULL
  ORDER BY created_at DESC
  ${limit > 0 ? sql`LIMIT ${limit}` : sql``}`;

console.log(`${rows.length} video posts without a preview${dry ? " (dry run)" : ""}\n`);

let done = 0, made = 0, failed = 0;
const queue = [...rows];

async function worker(n: number) {
  while (queue.length) {
    const row = queue.shift();
    if (!row) return;
    const short = String(row.image_url).slice(-38);
    try {
      const url = await ensurePreviewForUrl(row.image_url);
      if (url) {
        if (!dry) {
          await sql`UPDATE feed_posts SET preview_image_url = ${url} WHERE id = ${row.id}::uuid`;
        }
        made++;
        console.log(`  ok   ${short} → ${url.slice(-46)}`);
      } else {
        failed++;
        console.log(`  MISS ${short} (unfetchable or unsupported)`);
      }
    } catch (err: any) {
      failed++;
      console.log(`  ERR  ${short}: ${err?.message}`);
    }
    done++;
    if (done % 25 === 0) console.log(`  ── ${done}/${rows.length} ──`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

console.log(`\ndone: ${made} previews generated, ${failed} failed, ${rows.length} examined`);
process.exit(0);
