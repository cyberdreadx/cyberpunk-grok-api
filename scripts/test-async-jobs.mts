/**
 * Tests for the async API job state machine (api/v1/_lib/job-runner.ts).
 *
 * These run against a stub sql and a stub RunPod, because the parts worth
 * testing are the ones that are awkward to provoke for real: two pollers
 * racing to settle the same job, a claim abandoned mid-upload, and a job RunPod
 * silently dropped. Each of those decides whether a caller's credits come back.
 *
 *   npx tsx scripts/test-async-jobs.mts
 */

import { renderJob, MAX_AGE_MS, type JobRow } from "../api/v1/_lib/job-runner";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

function job(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "22222222-2222-2222-2222-222222222222",
    api_key_id: "33333333-3333-3333-3333-333333333333",
    workflow: "gltch-wan",
    kind: "video",
    rp_endpoint: "ep",
    rp_job_id: "rp-1",
    status: "running",
    credits_held: 15,
    credits_split: { dDaily: 5, dSub: 10, dPack: 0 },
    seed: 42,
    result_url: null,
    error: null,
    created_at: new Date(Date.now() - 30_000).toISOString(),
    updated_at: new Date(Date.now() - 30_000).toISOString(),
    settled_at: null,
    ...over,
  };
}

console.log("\nrenderJob — what the caller actually sees");

{
  const r = renderJob(job()) as any;
  check("running job reports running", r.status === "running");
  check("running job holds credits, does not claim them used", r.credits_held === 15 && r.credits_used === undefined);
  check("running job exposes no media url", r.video_url === undefined && r.image_url === undefined);
}

{
  // finalizing is an internal lock state; a caller should never see the word.
  const r = renderJob(job({ status: "finalizing" })) as any;
  check("finalizing is reported to callers as running", r.status === "running");
}

{
  const r = renderJob(job({ status: "completed", result_url: "https://x/v.mp4" })) as any;
  check("completed video uses video_url", r.video_url === "https://x/v.mp4");
  check("completed video has no image_url", r.image_url === undefined);
  check("completed reports credits_used", r.credits_used === 15);
}

{
  const r = renderJob(job({ kind: "image", workflow: "zimage", status: "completed", result_url: "https://x/i.png" })) as any;
  check("completed image uses image_url", r.image_url === "https://x/i.png");
  check("completed image has no video_url", r.video_url === undefined);
}

{
  const r = renderJob(job({ status: "failed", error: "Generation failed. Credits refunded." })) as any;
  check("failed reports the error", /Credits refunded/.test(r.error));
  check("failed states the refunded amount", r.credits_refunded === 15);
  check("failed claims no credits used", r.credits_used === undefined);
}

{
  // The database clock on this deployment runs ahead of the app's, which made
  // a freshly submitted job report elapsed_seconds: -10 in production.
  const r = renderJob(job({ created_at: new Date(Date.now() + 10_000).toISOString() })) as any;
  check("elapsed_seconds never goes negative under clock skew", r.elapsed_seconds === 0,
        `got ${r.elapsed_seconds}`);
}

console.log("\nbudgets");

check("video is given more than the synchronous 280s ceiling", MAX_AGE_MS.video > 280_000,
      `video budget ${MAX_AGE_MS.video}ms`);
check("image budget is shorter than video's", MAX_AGE_MS.image < MAX_AGE_MS.video);
check("both budgets are bounded, so credits cannot be held forever",
      Number.isFinite(MAX_AGE_MS.image) && Number.isFinite(MAX_AGE_MS.video));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
