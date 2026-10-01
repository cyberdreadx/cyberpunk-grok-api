/**
 * Re-encode feed previews that are PNG wearing a .webp name.
 *
 * mediaUpload.ts hardcoded Content-Type image/webp and a .webp extension for
 * every client-generated preview, regardless of what canvas.toBlob() actually
 * produced. A browser with no canvas WebP encoder silently returns PNG, so
 * those uploads stored PNG bytes under a WebP label. Browsers sniff content, so
 * they rendered correctly and the only symptom was weight: 230-360KB each
 * instead of 9-30KB, and seven of them on the first feed screen accounted for
 * 2.0MB of 2.27MB.
 *
 * The upload path is fixed, so this is only the existing objects. Each is
 * re-encoded to WebP and written back to the SAME key, so no database row
 * changes and no URL breaks. The source is already a 480px thumbnail, so the
 * re-encode costs nothing visually.
 *
 *   npx tsx --env-file=.env scripts/reencode-bad-previews.mts            # dry run
 *   npx tsx --env-file=.env scripts/reencode-bad-previews.mts --apply
 */

import { neon } from "@neondatabase/serverless";
import { uploadToR2, r2KeyFromUrl } from "../api/_lib/r2";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] || 400);

const sql = neon(process.env.DATABASE_URL!);
const sharp = (await import("sharp")).default;

const rows = (await sql`
  SELECT id, preview_image_url AS url
  FROM feed_posts
  WHERE preview_image_url IS NOT NULL
    AND preview_image_url LIKE '%-preview%'
  ORDER BY created_at DESC
  LIMIT ${LIMIT}
`) as { id: string; url: string }[];

console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${rows.length} previews to inspect\n`);

let checked = 0, bad = 0, fixed = 0, failed = 0;
let beforeBytes = 0, afterBytes = 0;

for (const r of rows) {
  const key = r2KeyFromUrl(r.url);
  if (!key) continue;
  try {
    const resp = await fetch(r.url);
    if (!resp.ok) continue;
    const buf = Buffer.from(await resp.arrayBuffer());
    checked++;

    const meta = await sharp(buf).metadata();
    if (meta.format === "webp") continue;   // already correct

    bad++;
    const out = await sharp(buf).webp({ quality: 82 }).toBuffer();
    beforeBytes += buf.length;
    afterBytes += out.length;

    const pct = Math.round((1 - out.length / buf.length) * 100);
    console.log(
      `  ${meta.format!.padEnd(4)} ${String(Math.round(buf.length / 1024)).padStart(4)}KB -> ` +
      `${String(Math.round(out.length / 1024)).padStart(3)}KB (-${pct}%)  ${key.slice(-52)}`,
    );

    if (APPLY) {
      // Same key, correct type. The URL in the database stays valid.
      await uploadToR2(key, out, "image/webp", { cacheControl: "public, max-age=604800" });
      fixed++;
    }
  } catch (err: any) {
    failed++;
    console.log(`  ERROR ${key.slice(-52)}: ${err?.message}`);
  }
}

console.log(`\n  inspected        : ${checked}`);
console.log(`  mislabelled      : ${bad}`);
if (bad) {
  console.log(`  before           : ${(beforeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  after            : ${(afterBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  saved            : ${((beforeBytes - afterBytes) / 1024 / 1024).toFixed(2)} MB` +
              ` (${Math.round((1 - afterBytes / beforeBytes) * 100)}%)`);
}
console.log(`  rewritten        : ${fixed}${APPLY ? "" : "  (dry run — nothing written)"}`);
if (failed) console.log(`  errors           : ${failed}`);
