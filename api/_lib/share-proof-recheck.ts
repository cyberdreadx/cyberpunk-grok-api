/**
 * Re-verifying social proofs after they have been paid for.
 *
 * The claim-time check proves a post existed and linked to us at that instant.
 * It cannot prove the post is still up tomorrow. Measured on 2026-10-01: of 71
 * X proofs from the previous 21 days, 20 had been deleted — 28% — and a single
 * account had deleted 10 of its 11. The mission exists to buy promotion. A
 * deleted post delivers none, so the credits go back.
 *
 * What this deliberately does NOT do is hold the reward until a post survives a
 * day. Most claimants are honest, and making all of them wait to stop a handful
 * would make the mission feel broken. Pay on claim, re-check later, reverse what
 * vanished.
 *
 * The probe semantics are the careful part, and they are deliberately
 * conservative in the user's favour:
 *
 *   404 twice  -> gone.       Clawed back.
 *   403        -> hidden.     NOT clawed back. An account going private or
 *                             getting locked is not the same act as deleting a
 *                             post, and from outside we cannot tell which
 *                             happened. Flagged for a human instead.
 *   anything   -> unreadable. Retried later, never charged for. The media
 *   else                      integrity probe booked 139 false positives by
 *                             treating throttling as absence; that mistake is
 *                             not worth repeating with people's credits.
 */

import { logCreditGrant } from "./credit-ledger";

/** Hours a post must have been up before we judge it. */
export const GRACE_HOURS = 36;

/**
 * A proof is checked at most this many times. Someone could delete a post
 * weeks later, but re-probing every proof forever costs an API call per proof
 * per run for no further signal, and three reads spread over days is enough to
 * catch the delete-after-paid loop this exists for.
 */
export const MAX_RECHECKS = 3;

/** Confirmed deletions before we stop accepting the mission from an account. */
export const DELETIONS_BEFORE_BLOCK = 2;

/**
 * Only proofs claimed within this window are re-checked.
 *
 * Without a bound the sweep walks back to April and bills people for posts that
 * are merely old. A first pass over the oldest 120 found 96 missing — but a
 * five-month-old tweet being gone is not the delete-for-credits loop this
 * exists to stop, those credits are long spent, and someone tidying their
 * timeline months later has defrauded nobody. Inside a month, a deletion and
 * the payment for it are plainly the same episode.
 */
export const MAX_AGE_DAYS = 30;

export type ProbeVerdict = "alive" | "gone" | "hidden" | "unreadable";

export interface ProofRow {
  id: string;
  user_id: string;
  platform: string;
  url: string;
  claim_date: string;
  recheck_count: number;
}

async function readOembed(url: string): Promise<number> {
  try {
    const r = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`,
      { redirect: "follow", signal: AbortSignal.timeout(10000) },
    );
    return r.status;
  } catch {
    return 0;
  }
}

/**
 * Decide whether a post is still there. Takes the reader so tests can drive it
 * without touching the network.
 */
export async function probeProof(
  url: string,
  read: (u: string) => Promise<number> = readOembed,
): Promise<ProbeVerdict> {
  let status = await read(url);
  if (status === 404) {
    // One 404 is not proof — confirm it before charging anyone.
    await new Promise((r) => setTimeout(r, 1500));
    status = await read(url);
    if (status === 404) return "gone";
  }
  if (status === 200) return "alive";
  if (status === 403) return "hidden";
  return "unreadable";
}

/**
 * Take back the credits a now-deleted proof was paid for.
 *
 * Floored at the balance on hand: driving an account negative would block it
 * from generating at all, which is a harsher penalty than the offence and would
 * mostly hit people who simply spent the credits already. Whatever cannot be
 * recovered is recorded as recovered-in-part rather than chased.
 */
export async function clawBackProof(
  sql: any,
  proof: ProofRow,
  credits: number,
): Promise<number> {
  // Measure what actually came off instead of assuming the full amount. An
  // account that has already spent the credits yields less, and the ledger has
  // to record what was recovered, not what was owed.
  const [before] = await sql`
    SELECT (daily_credits + sub_credits + pack_credits) AS total
    FROM users WHERE id = ${proof.user_id}::uuid
  `;
  if (!before) return 0;

  const [after] = await sql`
    UPDATE users SET
      daily_credits = GREATEST(daily_credits - LEAST(${credits}, daily_credits), 0),
      pack_credits  = GREATEST(pack_credits  - GREATEST(${credits} - daily_credits, 0), 0),
      updated_at = now()
    WHERE id = ${proof.user_id}::uuid
    RETURNING (daily_credits + sub_credits + pack_credits) AS total
  `;
  const taken = Math.max(0, Number(before.total) - Number(after?.total ?? before.total));

  // Mark the proof even when nothing was recoverable, so it is not probed again
  // every run forever.
  await sql`
    UPDATE daily_share_proofs
    SET recheck_status = 'gone', rechecked_at = now(),
        recheck_count = recheck_count + 1, clawed_back = ${taken}
    WHERE id = ${proof.id}::uuid
  `;

  if (taken > 0) {
    await logCreditGrant(
      sql, proof.user_id, -taken, "share_proof_deleted",
      `${proof.platform} post deleted after payment: ${proof.url.slice(0, 120)}`,
    );
  }
  return taken;
}

export async function recordVerdict(
  sql: any,
  proof: ProofRow,
  verdict: ProbeVerdict,
): Promise<void> {
  await sql`
    UPDATE daily_share_proofs
    SET recheck_status = ${verdict}, rechecked_at = now(),
        recheck_count = recheck_count + 1
    WHERE id = ${proof.id}::uuid
  `;
}

/**
 * Proofs due for a look: old enough to judge, not already written off, and not
 * already read MAX_RECHECKS times. A proof checked in the last day is skipped —
 * nothing changes minute to minute and each check is an API call.
 */
export async function dueForRecheck(sql: any, limit: number): Promise<ProofRow[]> {
  return (await sql`
    SELECT id, user_id, platform, url, claim_date, recheck_count
    FROM daily_share_proofs p
    WHERE p.platform = 'twitter'
      AND p.clawed_back = 0
      AND p.recheck_status IS DISTINCT FROM 'gone'
      AND p.recheck_count < ${MAX_RECHECKS}
      AND p.created_at < now() - ${`${GRACE_HOURS} hours`}::interval
      AND p.created_at > now() - ${`${MAX_AGE_DAYS} days`}::interval
      AND (rechecked_at IS NULL OR rechecked_at < now() - interval '24 hours')
      /*
       * Never charge twice for the same post.
       *
       * The September sweep judged 2,097 proofs unverifiable and took 7,328
       * credits from 427 accounts. Every one of those rows is still here, and a
       * post that was unreadable then is usually a 404 now — so without this
       * clause the deletion sweep would bill the same people again for the same
       * posts. Eight accounts were in that position, one of them holding 106
       * such proofs.
       *
       * A prior verdict of false means the credits are already gone. There is
       * nothing left to recover and no second offence to answer for.
       */
      AND NOT EXISTS (
        SELECT 1 FROM share_proof_verdicts v
        WHERE v.proof_id = p.id AND v.links_to_us = false
      )
    ORDER BY p.created_at
    LIMIT ${limit}
  `) as ProofRow[];
}

/** How many of this account's proofs have been confirmed deleted. */
export async function confirmedDeletions(sql: any, userId: string): Promise<number> {
  const [row] = await sql`
    SELECT COUNT(*)::int AS n FROM daily_share_proofs
    WHERE user_id = ${userId}::uuid AND recheck_status = 'gone'
  `;
  return Number(row?.n ?? 0);
}
