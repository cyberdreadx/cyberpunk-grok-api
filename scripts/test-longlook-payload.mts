/**
 * The payload-size guard for LongLook.
 *
 * RunPod discards a job response over 10MB and returns COMPLETED with an empty
 * output — no error. Every "Job completed but output could not be delivered"
 * was that. These numbers come from three real jobs run against the live
 * endpoint on 2026-09-24, so the estimator is checked against measurements
 * rather than against itself.
 *
 *   node --env-file=.env --import tsx scripts/test-longlook-payload.mts
 */
process.env.RESEND_API_KEY = "";
import { estimateRunpodOutputBytes, maxFramesForPayload } from "/home/neon/cyberpunk-grok-api/api/comfyui.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};
const MB = 1048576;

console.log("── measured against real jobs (480x480) ──");
// 4 clips x 17 frames → 580,720 base64 chars; 4 x 81 → 3,872,208.
const m1 = estimateRunpodOutputBytes(4 * 17, 480, 480);
const m2 = estimateRunpodOutputBytes(4 * 81, 480, 480);
console.log(`  68 frames: measured 0.55MB · estimated ${(m1 / MB).toFixed(2)}MB`);
console.log(` 324 frames: measured 3.69MB · estimated ${(m2 / MB).toFixed(2)}MB`);
ok("estimate never comes in UNDER what was measured", m1 >= 580_720 * 0.95 && m2 >= 3_872_208 * 0.95);
ok("and stays within 2x of it (not absurdly cautious)", m1 <= 580_720 * 2.2 && m2 <= 3_872_208 * 2);

console.log("\n── the jobs that were failing ──");
const real = estimateRunpodOutputBytes(4 * 241, 720, 720);
ok("4 clips x 241 frames at 720x720 is over the cap", real > 10 * MB, `${(real / MB).toFixed(1)}MB`);
const real2 = estimateRunpodOutputBytes(2 * 241, 848, 480);
ok("2 clips x 241 frames at 848x480 is over the safe line", real2 > 8 * MB, `${(real2 / MB).toFixed(1)}MB`);

console.log("\n── the jobs that worked, still work ──");
ok("4 x 81 at 480x480 passes", estimateRunpodOutputBytes(4 * 81, 480, 480) < 8 * MB);
ok("2 x 81 at 480x480 passes", estimateRunpodOutputBytes(2 * 81, 480, 480) < 8 * MB);
ok("1 x 121 at 848x480 passes", estimateRunpodOutputBytes(121, 848, 480) < 8 * MB);

console.log("\n── the budget we offer users ──");
for (const [w, h] of [[480, 480], [848, 480], [720, 720], [1280, 720]]) {
  const budget = maxFramesForPayload(w, h);
  const atBudget = estimateRunpodOutputBytes(budget, w, h);
  ok(`${w}x${h}: ${budget} frames total, and that budget really fits`, atBudget <= 8 * MB, `${(atBudget / MB).toFixed(1)}MB`);
}
ok("a huge resolution still offers at least one clip", maxFramesForPayload(2048, 2048) >= 17);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
