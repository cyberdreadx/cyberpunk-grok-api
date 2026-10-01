/**
 * Tests for social-proof re-verification (api/_lib/share-proof-recheck.ts).
 *
 * The probe decides whether to take credits off a real person, so the cases
 * that matter are the ones where it should NOT: a throttled read, a locked
 * account, a single flaky 404. Each is driven through a stub reader so no
 * network is involved and the semantics are pinned.
 *
 *   npx tsx scripts/test-share-proof-recheck.mts
 */

import {
  probeProof, GRACE_HOURS, MAX_RECHECKS,
  DELETIONS_BEFORE_BLOCK, MAX_AGE_DAYS,
} from "../api/_lib/share-proof-recheck";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

/** A reader that returns a fixed sequence of statuses, then repeats the last. */
function reader(...statuses: number[]) {
  let i = 0;
  const calls: string[] = [];
  const fn = async (u: string) => { calls.push(u); return statuses[Math.min(i++, statuses.length - 1)]; };
  return Object.assign(fn, { calls: () => calls.length });
}

console.log("\nprobe verdicts");

{
  const r = reader(200);
  check("a readable post is alive", (await probeProof("u", r)) === "alive");
}

{
  const r = reader(404, 404);
  check("404 twice is gone", (await probeProof("u", r)) === "gone");
  check("  and it took two reads to say so", r.calls() === 2, `${r.calls()} reads`);
}

{
  // The important one. A single 404 can be a blip; charging on it would take
  // credits from someone whose post is still up.
  const r = reader(404, 200);
  const v = await probeProof("u", r);
  check("404 then 200 is NOT gone", v !== "gone", `got ${v}`);
  check("  it is reported alive", v === "alive");
}

{
  const r = reader(429);
  const v = await probeProof("u", r);
  check("rate limiting is never 'gone'", v !== "gone", `got ${v}`);
  check("  it is unreadable, to be retried", v === "unreadable");
}

{
  const r = reader(403);
  const v = await probeProof("u", r);
  check("a locked or private account is 'hidden', not 'gone'", v === "hidden", `got ${v}`);
}

{
  const r = reader(0);
  check("a network failure is unreadable, not gone", (await probeProof("u", r)) === "unreadable");
}

{
  const r = reader(500);
  check("a server error is unreadable, not gone", (await probeProof("u", r)) === "unreadable");
}

console.log("\npolicy constants");

check("a post gets at least a day before being judged", GRACE_HOURS >= 24, `${GRACE_HOURS}h`);
check("re-checks are bounded, so proofs are not probed forever", MAX_RECHECKS > 0 && MAX_RECHECKS <= 5);
check("one deletion does not close the mission", DELETIONS_BEFORE_BLOCK > 1,
      `blocks at ${DELETIONS_BEFORE_BLOCK}`);
check("the sweep does not reach back months", MAX_AGE_DAYS <= 45, `${MAX_AGE_DAYS} days`);
check("the window is wider than the grace period, or nothing is ever eligible",
      MAX_AGE_DAYS * 24 > GRACE_HOURS);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
