/**
 * Re-check social proofs that have already been paid for, and reverse the ones
 * that were deleted.
 *
 * Measured when this was written: 20 of the last 71 X proofs had been deleted
 * after the credits were paid — 28% — with one account responsible for 10 of
 * them. See api/_lib/share-proof-recheck.ts for the probe semantics and why a
 * 403 is treated differently from a 404.
 *
 *   ?dryRun=1   report what would be reversed, change nothing
 *   ?limit=N    proofs examined this run (default 60)
 *   ?quiet=1    log only when something changed
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import {
  dueForRecheck, probeProof, clawBackProof, recordVerdict,
  DELETIONS_BEFORE_BLOCK, confirmedDeletions,
} from "./_lib/share-proof-recheck";

/** Must match MISSION_CREDITS.twitter in api/daily-missions.ts. */
const TWITTER_MISSION_CREDITS = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (given !== secret) return res.status(401).json({ error: "Unauthorized" });
  }

  const dryRun = req.query?.dryRun === "1";
  const quiet = req.query?.quiet === "1";
  const limit = Math.min(300, Math.max(1, Number(req.query?.limit) || 60));

  try {
    const sql = getDb();
    const due = await dueForRecheck(sql, limit);

    const counts = { alive: 0, gone: 0, hidden: 0, unreadable: 0 };
    let recovered = 0;
    const deleted: { url: string; user_id: string }[] = [];
    const newlyBlocked: string[] = [];

    for (const proof of due) {
      const verdict = await probeProof(proof.url);
      counts[verdict]++;

      if (verdict === "gone") {
        deleted.push({ url: proof.url, user_id: proof.user_id });
        if (!dryRun) {
          recovered += await clawBackProof(sql, proof, TWITTER_MISSION_CREDITS);
          // Crossing the threshold is worth a log line: it is the point at
          // which the account stops being able to claim this mission.
          const n = await confirmedDeletions(sql, proof.user_id);
          if (n === DELETIONS_BEFORE_BLOCK) newlyBlocked.push(proof.user_id);
        }
      } else if (!dryRun) {
        await recordVerdict(sql, proof, verdict);
      }

      // Courtesy pause — this is an unauthenticated public endpoint and
      // hammering it is how the reads start coming back as 429s, which this
      // code would then have to treat as "unreadable" and retry forever.
      await new Promise((r) => setTimeout(r, 250));
    }

    const changed = counts.gone > 0;
    if (!quiet || changed) {
      console.log(
        `[cron-share-proof-recheck] ${dryRun ? "DRY RUN " : ""}examined ${due.length}: ` +
        `${counts.alive} alive, ${counts.gone} deleted, ${counts.hidden} hidden, ` +
        `${counts.unreadable} unreadable — ${recovered} credits recovered` +
        (newlyBlocked.length ? `, ${newlyBlocked.length} account(s) now blocked from the mission` : ""),
      );
    }

    return res.status(200).json({
      dryRun, examined: due.length, ...counts,
      credits_recovered: recovered,
      newly_blocked: newlyBlocked.length,
      deleted: dryRun ? deleted.slice(0, 50) : undefined,
    });
  } catch (err: any) {
    console.error("[cron-share-proof-recheck] error:", err?.message);
    return res.status(500).json({ error: "Internal error" });
  }
}
