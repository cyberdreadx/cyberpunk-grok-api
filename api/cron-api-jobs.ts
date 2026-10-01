/**
 * Sweep asynchronous API jobs that nobody is polling.
 *
 * The happy path needs no cron: a caller polls GET /api/v1/jobs?id=... and
 * that poll is what finalises the job. This exists for the case where they
 * stop — the script was killed, the agent moved on, the network went away.
 * Without a sweep those jobs would sit in `running` forever holding the
 * caller's credits, and a finished RunPod result would go unstored.
 *
 * It calls exactly the same advanceJob() the poll endpoint does, so a job
 * settled by the sweep is indistinguishable from one settled by its owner.
 *
 *   ?quiet=1    only log when something changed
 *   ?limit=N    cap rows examined this run (default 40)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { advanceJob, type JobRow } from "./v1/_lib/job-runner";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (given !== secret) return res.status(401).json({ error: "Unauthorized" });
  }

  const quiet = req.query?.quiet === "1";
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 40));

  try {
    const sql = getDb();

    /*
     * Only rows nobody has touched for a minute. A job being actively polled
     * is already being advanced by its owner, and racing them here would just
     * burn RunPod status reads — the claim would fail harmlessly, but there is
     * no reason to make the call.
     */
    const open = (await sql`
      SELECT * FROM api_jobs
      WHERE settled_at IS NULL
        AND updated_at < now() - interval '60 seconds'
      ORDER BY created_at
      LIMIT ${limit}
    `) as JobRow[];

    let completed = 0, failed = 0, still = 0;
    for (const job of open) {
      const after = await advanceJob(sql, job);
      if (after.status === "completed") completed++;
      else if (after.status === "failed") failed++;
      else still++;
    }

    const changed = completed + failed;
    if (!quiet || changed > 0) {
      console.log(`[cron-api-jobs] examined ${open.length}: ${completed} completed, ${failed} failed/refunded, ${still} still running`);
    }

    return res.status(200).json({ examined: open.length, completed, failed, still_running: still });
  } catch (err: any) {
    console.error("[cron-api-jobs] error:", err?.message);
    return res.status(500).json({ error: "Internal error" });
  }
}
