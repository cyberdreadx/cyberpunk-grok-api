/**
 * Advancing an asynchronous API job.
 *
 * Two callers drive the same state machine: a caller polling
 * GET /api/v1/jobs?id=..., and the cron sweep that finishes jobs nobody is
 * polling any more. They must behave identically, so the logic lives here
 * rather than in either of them.
 *
 * running -> finalizing -> completed | failed
 *
 * `finalizing` is not decoration. The Neon HTTP driver has no transactions, so
 * there is no way to hold a lock across the "RunPod says COMPLETED" read and
 * the "store the output and settle the credits" write. Instead a caller claims
 * the row by moving it out of `running` with a conditional UPDATE. Exactly one
 * claim succeeds; everyone else sees `finalizing` and reports the job as still
 * running. This is the same claim-then-act shape used elsewhere in the
 * codebase for the referral payouts and the lifecycle sends.
 *
 * A claim that dies mid-flight — process restart during an R2 upload — would
 * otherwise strand the row in `finalizing` forever, so a claim older than
 * STALE_CLAIM_MS is reclaimable.
 */

import {
  pollRunPod,
  extractComfyOutput,
  toPublicUrl,
  isVideoWorkflow,
} from "./comfy-job";
import { refundCredits, logUsage } from "./credits";

/** A claim this old is assumed dead and may be taken over. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

/**
 * How long a job may sit unfinished before it is written off and refunded.
 * Video is given far longer than the synchronous endpoint's 280s ceiling,
 * which is the entire point of this path; it is still bounded so a job RunPod
 * silently dropped cannot hold a caller's credits forever.
 */
export const MAX_AGE_MS = { image: 20 * 60 * 1000, video: 60 * 60 * 1000 };

export interface JobRow {
  id: string;
  user_id: string;
  api_key_id: string | null;
  workflow: string;
  kind: "image" | "video";
  rp_endpoint: string;
  rp_job_id: string;
  status: string;
  credits_held: number;
  credits_split: { dDaily?: number; dSub?: number; dPack?: number };
  seed: string | number | null;
  result_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
}

async function refundAndFail(sql: any, job: JobRow, message: string): Promise<JobRow> {
  const split = job.credits_split || {};
  await refundCredits(sql, job.user_id, {
    dDaily: Number(split.dDaily || 0),
    dSub: Number(split.dSub || 0),
    dPack: Number(split.dPack || 0),
  });
  const [row] = await sql`
    UPDATE api_jobs
    SET status = 'failed', error = ${message}, settled_at = now(), updated_at = now()
    WHERE id = ${job.id}::uuid
    RETURNING *
  `;
  console.log(`[v1/jobs] ${job.id} failed (${message}) — ${job.credits_held} credits refunded`);
  return row as JobRow;
}

/**
 * Take the row out of `running` so this caller alone may settle it.
 * A row whose previous claim has gone stale is also claimable.
 */
async function claim(sql: any, job: JobRow): Promise<boolean> {
  const [row] = await sql`
    UPDATE api_jobs
    SET status = 'finalizing', updated_at = now()
    WHERE id = ${job.id}::uuid
      AND settled_at IS NULL
      AND (
        status = 'running'
        OR (status = 'finalizing' AND updated_at < now() - ${`${STALE_CLAIM_MS} milliseconds`}::interval)
      )
    RETURNING id
  `;
  return !!row;
}

/**
 * Read RunPod once and move the job forward if it has anything to say.
 * Returns the row as it now stands; callers render it straight to the caller.
 */
export async function advanceJob(sql: any, job: JobRow): Promise<JobRow> {
  if (job.status === "completed" || job.status === "failed") return job;

  const ageMs = Date.now() - new Date(job.created_at).getTime();
  const maxAge = MAX_AGE_MS[job.kind] ?? MAX_AGE_MS.image;

  const poll = await pollRunPod(job.rp_endpoint, job.rp_job_id);

  // A failed status read is not a failed job — RunPod rate-limits and blips.
  // Report the job as still running and try again on the next poll, unless it
  // has outlived its budget entirely.
  if (!poll) {
    if (ageMs > maxAge && (await claim(sql, job))) {
      return refundAndFail(sql, job, "Generation expired without a result. Credits refunded.");
    }
    return job;
  }

  const status = String(poll.status || "").toUpperCase();

  if (status === "COMPLETED") {
    if (!(await claim(sql, job))) return job; // someone else is settling it
    const result = extractComfyOutput(poll.output, isVideoWorkflow(job.workflow));
    if (!result) {
      return refundAndFail(sql, job, `Generation completed but no ${job.kind} was returned. Credits refunded.`);
    }
    const url = await toPublicUrl(result.data, result.type, job.user_id);
    if (!url) {
      return refundAndFail(sql, job, `Generation succeeded but the ${result.type} could not be stored. Credits refunded.`);
    }
    // Usage is logged at completion, not submit, so the figures count work
    // actually delivered. A refunded job never lands here.
    if (job.api_key_id) {
      await logUsage(sql, { apiKeyId: job.api_key_id, userId: job.user_id },
        `jobs:${job.workflow}`, job.credits_held, "async");
    }
    const [row] = await sql`
      UPDATE api_jobs
      SET status = 'completed', result_url = ${url}, settled_at = now(), updated_at = now()
      WHERE id = ${job.id}::uuid
      RETURNING *
    `;
    console.log(`[v1/jobs] ${job.id} completed (${job.workflow}, ${Math.round(ageMs / 1000)}s)`);
    return row as JobRow;
  }

  if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(status)) {
    if (!(await claim(sql, job))) return job;
    const detail = typeof poll.error === "string" && poll.error ? poll.error : status.toLowerCase();
    return refundAndFail(sql, job, `Generation ${detail}. Credits refunded.`);
  }

  // IN_QUEUE or IN_PROGRESS — still working.
  if (ageMs > maxAge && (await claim(sql, job))) {
    return refundAndFail(sql, job, "Generation exceeded its time budget. Credits refunded.");
  }
  // Keep a wedged `finalizing` row from looking stuck to the caller forever.
  if (job.status === "finalizing"
      && Date.now() - new Date(job.updated_at).getTime() > STALE_CLAIM_MS) {
    const [row] = await sql`
      UPDATE api_jobs SET status = 'running', updated_at = now()
      WHERE id = ${job.id}::uuid AND status = 'finalizing' AND settled_at IS NULL
      RETURNING *
    `;
    if (row) return row as JobRow;
  }
  return job;
}

/** The caller-facing shape of a job, in both the submit and poll responses. */
export function renderJob(job: JobRow) {
  const base: Record<string, unknown> = {
    job_id: job.id,
    status: job.status === "finalizing" ? "running" : job.status,
    workflow: job.workflow,
    kind: job.kind,
    created_at: job.created_at,
    // Clamped: created_at comes from the database's clock and this process
    // reads its own, and Neon runs far enough ahead that a job polled straight
    // after submit reported elapsed_seconds: -10.
    elapsed_seconds: Math.max(0, Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000)),
  };
  if (job.status === "completed") {
    base[job.kind === "video" ? "video_url" : "image_url"] = job.result_url;
    base.seed = job.seed === null ? null : Number(job.seed);
    base.credits_used = job.credits_held;
  } else if (job.status === "failed") {
    base.error = job.error;
    base.credits_refunded = job.credits_held;
  } else {
    base.credits_held = job.credits_held;
  }
  return base;
}
