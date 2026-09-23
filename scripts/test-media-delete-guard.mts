/**
 * deleteMediaUrls must never destroy a file something else still points at, and
 * never touch a user's library at all unless the caller owns that decision.
 *
 * On 2026-09-23 revoking a share deleted the shared video itself: 60 of 191 video
 * downloads returned 404 and feed posts were left pointing at nothing.
 *
 * Read-only against real data: the keys it "deletes" are fabricated and do not
 * exist, so a pass costs nothing. The assertions are about which keys are handed
 * to storage at all.
 *
 *   node --env-file=.env --import tsx scripts/test-media-delete-guard.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { deleteMediaUrls } from "/home/neon/cyberpunk-grok-api/api/_lib/media-delete.ts";
import { isLibraryKey, loadReferencedKeys } from "/home/neon/cyberpunk-grok-api/api/_lib/media-refs.ts";

const sql = getDb();
const HOST = "https://pub-0a4d910130d047e9a9c0e03feb7fcca6.r2.dev";
const rnd = () => Math.random().toString(36).slice(2, 10);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};

console.log("── what counts as a library file ──");
ok("a generation output is library", isLibraryKey("comfyui-output/abc/1.mp4"));
ok("gltch/ is library", isLibraryKey("gltch/abc-1.mp4"));
ok("seedance/ is library", isLibraryKey("seedance/abc-1.mp4"));
ok("a feed object is NOT library", !isLibraryKey("feed/abc/post-1.mp4"));
ok("a story object is NOT library", !isLibraryKey("stories/abc/1.mp4"));
ok("a share object is NOT library", !isLibraryKey("shares/abc.mp4"));

console.log("\n── a file the feed still points at ──");
const [post] = (await sql`
  SELECT image_url FROM feed_posts
  WHERE image_url LIKE ${HOST + "%"} AND image_url NOT LIKE '%comfyui-output%'
  LIMIT 1`) as any[];
if (post?.image_url) {
  const t = await deleteMediaUrls([post.image_url]);
  ok("a referenced feed file is refused", t.r2.found === 0 && t.skipped > 0, JSON.stringify(t.r2));
} else {
  const refs = await loadReferencedKeys();
  ok("reference set loads (no non-library feed file to sample)", refs.r2.size > 0, `${refs.r2.size} keys referenced`);
}

console.log("\n── a library file nothing in the database references ──");
const libUrl = `${HOST}/comfyui-output/${crypto.randomUUID()}/${Date.now()}-${rnd()}.mp4`;
const libTally = await deleteMediaUrls([libUrl]);
ok("a library file is refused by default", libTally.r2.found === 0 && libTally.skipped > 0, JSON.stringify(libTally.r2));

console.log("\n── the surfaces that DO own library deletion ──");
const ownerTally = await deleteMediaUrls([libUrl], { allowLibraryMedia: true });
ok("allowLibraryMedia lets the owner through", ownerTally.r2.found > 0, JSON.stringify(ownerTally.r2));

console.log("\n── a file that really is the surface's own ──");
const storyUrl = `${HOST}/stories/${crypto.randomUUID()}/${Date.now()}-${rnd()}.mp4`;
const storyTally = await deleteMediaUrls([storyUrl]);
ok("an unreferenced story object is still deleted", storyTally.r2.found > 0, JSON.stringify(storyTally.r2));

console.log("\n── the preview companion follows the same rule ──");
const libPreview = `${HOST}/comfyui-output/${crypto.randomUUID()}/${Date.now()}-${rnd()}-preview.webp`;
const pv = await deleteMediaUrls([libPreview]);
ok("a library preview is refused too", pv.r2.found === 0, JSON.stringify(pv.r2));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
