/**
 * Decide whether the leftover scratch .mp4s on the network volume are safe to
 * delete, before deleting any of them.
 *
 * RunPod stages each job's output in /workspace/<job-id>-uN. The worker's
 * cleanup patch calls the handler outside its try block, so any job that
 * raised left its staging dir behind. 4,221 survive with a video still in
 * them.
 *
 * The question is not "are these files old" but "is any of them the only
 * surviving copy of something a user paid for". usage_log records job_id for
 * every comfy submit, so each scratch dir can be matched to the job that made
 * it and classified:
 *
 *   refunded  - the user got their credits back; the file is garbage
 *   charged   - the user paid and the render is in their library via R2
 *   unknown   - no usage_log row at all
 *
 * Only the unknown bucket needs a human decision.
 *
 *   node --env-file=.env --import tsx scripts/scratch-orphan-audit.mts
 */
process.env.RESEND_API_KEY = "";

import { readFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();

// The -uN suffix IS part of the id RunPod reports and what comfyui.ts writes
// to usage_log.job_id — a submit returns e.g. "a9c0…-u2". The directory name
// is the job id verbatim; stripping the suffix matches nothing.
const dirs = readFileSync("/tmp/gltch-work/scratch-jobs.txt", "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean);
const jobIds = [...new Set(dirs)];
console.log(`${dirs.length} scratch dirs -> ${jobIds.length} distinct job ids\n`);

const rows = await sql`
  SELECT job_id, mode, credits_used, created_at
  FROM usage_log
  WHERE job_id = ANY(${jobIds})` as any[];

const byId = new Map<string, any[]>();
for (const r of rows) {
  if (!byId.has(r.job_id)) byId.set(r.job_id, []);
  byId.get(r.job_id)!.push(r);
}

let refunded = 0, charged = 0, unknown = 0, freeAdmin = 0;
const unknownIds: string[] = [];
for (const id of jobIds) {
  const rs = byId.get(id);
  if (!rs?.length) { unknown++; unknownIds.push(id); continue; }
  if (rs.some((r) => String(r.mode).includes("refunded"))) refunded++;
  else if (rs.some((r) => Number(r.credits_used) > 0)) charged++;
  else freeAdmin++;
}

console.log(`  refunded      ${String(refunded).padStart(5)}  credits returned — file is garbage`);
console.log(`  charged       ${String(charged).padStart(5)}  user paid; delivered copy lives in R2`);
console.log(`  free/admin    ${String(freeAdmin).padStart(5)}  logged at 0 credits`);
console.log(`  no log row    ${String(unknown).padStart(5)}  never reached usage_log`);

if (rows.length) {
  const [span] = await sql`
    SELECT min(created_at)::date AS oldest, max(created_at)::date AS newest
    FROM usage_log WHERE job_id = ANY(${jobIds})` as any[];
  console.log(`\ndate range of matched jobs: ${span.oldest} .. ${span.newest}`);
}

// A job that never reached usage_log was never charged, so nothing was paid
// for and nothing is owed — but show a sample so the claim is checkable.
if (unknownIds.length) {
  console.log(`\nsample of unmatched job ids:`);
  for (const id of unknownIds.slice(0, 5)) console.log(`  ${id}`);
}
process.exit(0);
