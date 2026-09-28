/**
 * videoPosterUrl — the still frame a library video tile should show.
 *
 *   node --import tsx scripts/test-video-poster.mts
 */
import { videoPosterUrl } from "/home/neon/cyberpunk-grok-api/src/lib/videoPoster.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};
const R2 = "https://pub-0a4d910130d047e9a9c0e03feb7fcca6.r2.dev";

ok("derives the companion still for an R2 video",
   videoPosterUrl(`${R2}/comfyui-output/u/123-abc.mp4`) === `${R2}/comfyui-output/u/123-abc-preview.webp`,
   String(videoPosterUrl(`${R2}/comfyui-output/u/123-abc.mp4`)));
ok("works for webm too", (videoPosterUrl(`${R2}/a/b.webm`) ?? "").endsWith("-preview.webp"));
ok("works on the blob store",
   (videoPosterUrl("https://b1ynbqvcamyje8yr.public.blob.vercel-storage.com/feed/x/post.mp4") ?? "").endsWith("-preview.webp"));
ok("drops a query string so the key still matches",
   videoPosterUrl(`${R2}/a/b.mp4?v=2`) === `${R2}/a/b-preview.webp`);
ok("a preview URL passes through unchanged",
   videoPosterUrl(`${R2}/a/b-preview.webp`) === `${R2}/a/b-preview.webp`);

console.log("\n  and the cases where guessing would be wrong:");
ok("local blob: URLs get nothing (they decode instantly)", videoPosterUrl("blob:https://app/abc") === undefined);
ok("data: URLs get nothing", videoPosterUrl("data:video/mp4;base64,AAAA") === undefined);
ok("someone else's host gets nothing", videoPosterUrl("https://cdn.example.com/a/b.mp4") === undefined);
ok("a URL with no extension gets nothing", videoPosterUrl(`${R2}/a/novideo`) === undefined);
ok("empty input is safe", videoPosterUrl("") === undefined && videoPosterUrl(null) === undefined);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
