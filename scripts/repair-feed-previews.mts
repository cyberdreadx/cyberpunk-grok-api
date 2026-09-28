/**
 * Rebuild feed previews that the Blob sweep deleted.
 *
 * cron-blob-orphans never counted preview_image_url as a reference, so on
 * 2026-09-27 it deleted every feed preview stored on Vercel Blob — 123 of them.
 * The originals are untouched, so the thumbnails can simply be made again, this
 * time landing on R2 where the sweep and the delete guard both protect them.
 *
 *   node --env-file=.env --import tsx scripts/repair-feed-previews.mts          # dry run
 *   node --env-file=.env --import tsx scripts/repair-feed-previews.mts --apply
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { ensurePreviewForUrl } from "/home/neon/cyberpunk-grok-api/api/_lib/ensure-preview.ts";

const APPLY = process.argv.includes("--apply");
const sql = getDb();

const posts = (await sql`
  SELECT id, image_url, preview_image_url FROM feed_posts
  WHERE preview_image_url IS NOT NULL AND image_url IS NOT NULL
  ORDER BY created_at DESC`) as any[];

const broken: any[] = [];
await Promise.all(posts.map(async (p) => {
  try {
    const r = await fetch(p.preview_image_url, { method: "HEAD" });
    if (!r.ok) broken.push(p);
  } catch { broken.push(p); }
}));

console.log(`${posts.length} posts have a preview · ${broken.length} of those previews are gone`);
if (!APPLY) { console.log("\n(dry run — pass --apply to rebuild)"); process.exit(0); }

let fixed = 0, failed = 0, skipped = 0;
for (const p of broken) {
  // The original has to still exist, or there is nothing to make a preview from.
  const alive = await fetch(p.image_url, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
  if (!alive) { skipped++; continue; }
  try {
    const url = await ensurePreviewForUrl(p.image_url);
    if (!url) { failed++; continue; }
    await sql`UPDATE feed_posts SET preview_image_url = ${url} WHERE id = ${p.id}`;
    fixed++;
  } catch (err: any) {
    console.warn(`  ${String(p.id).slice(0, 8)}: ${err?.message}`);
    failed++;
  }
}
console.log(`\nrebuilt ${fixed} · failed ${failed} · skipped (original also gone) ${skipped}`);
