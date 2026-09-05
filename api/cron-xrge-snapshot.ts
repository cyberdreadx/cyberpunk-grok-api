/**
 * /api/cron-xrge-snapshot — Daily XRGE holder snapshot.
 *
 * For every user with a bound wallet OR a positive bank balance:
 *   1. Read on-chain XRGE balance via Base RPC (balanceOf)
 *   2. Read custodial bank balance
 *   3. Compute total held → derive holder tier
 *   4. Update streak (holder_tier_since) using strict rules:
 *        • new tier = none           → since = NULL
 *        • streak resets if tier rank dropped
 *        • streak preserved if tier rank stayed or upgraded
 *   5. Insert snapshot row + update users table
 *
 * After processing, prunes snapshots older than 30 days.
 *
 * Secured via CRON_SECRET Bearer token (matches cron-reset-daily pattern).
 * Scheduled daily at 03:10 UTC in vercel.json.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getXrgeBalanceOnChain, weiToXrge } from "./_lib/xrge";
import { getHolderTier, tierRank } from "./v1/_lib/xrge-holder";

export const config = { maxDuration: 300 };

const RPC_BATCH_SIZE = 8;
const RPC_BATCH_DELAY_MS = 250;
const SNAPSHOT_RETENTION_DAYS = 30;

interface EligibleUser {
  id: string;
  wallet_address: string | null;
  profile_wallet: string | null;
  xrge_bank_balance: string;
  holder_tier: string;
  holder_tier_since: string | Date | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sql = getDb();
  const startedAt = Date.now();
  let processed = 0;
  let snapshotted = 0;
  let tierChanges = 0;
  let onChainSuccess = 0;
  let onChainFailures = 0;

  try {
    // users.wallet_address is the only tier source. profiles.wallet_address used
    // to be a fallback here, but it was writable through PUT /api/profile with no
    // ownership proof and no uniqueness check, so it could carry an address the
    // account did not control — or one another account had already claimed.
    // It is a creator payout field now; tier binding goes through the signature
    // challenge in /api/v1/xrge-wallet, which writes both columns.
    const users = (await sql`
      SELECT
        u.id,
        u.wallet_address,
        u.xrge_bank_balance,
        u.holder_tier,
        u.holder_tier_since,
        NULL::text AS profile_wallet
      FROM users u
      WHERE
        u.wallet_address IS NOT NULL
        OR u.xrge_bank_balance > 0
        -- Anyone still carrying a tier has to stay in the set even with nothing
        -- left to measure, or the tier freezes at its last value. That covers
        -- users who unbind, and the ones whose tier came from the profile column
        -- this query no longer reads.
        OR (u.holder_tier IS NOT NULL AND u.holder_tier <> 'none')
    `) as EligibleUser[];

    console.log(`[cron-xrge-snapshot] processing ${users.length} eligible users`);

    for (let i = 0; i < users.length; i += RPC_BATCH_SIZE) {
      const batch = users.slice(i, i + RPC_BATCH_SIZE);

      await Promise.all(
        batch.map(async (u) => {
          processed++;
          const walletAddress = u.wallet_address || u.profile_wallet || null;
          const bankBalance = parseFloat(u.xrge_bank_balance) || 0;

          let walletBalance = 0;
          if (walletAddress) {
            try {
              const wei = await getXrgeBalanceOnChain(walletAddress);
              walletBalance = parseFloat(weiToXrge(wei));
              onChainSuccess++;
            } catch (e: any) {
              console.warn(
                `[cron-xrge-snapshot] balance fetch failed for ${u.id}/${walletAddress}:`,
                e?.message,
              );
              onChainFailures++;
              // Bail on this user this run — don't snapshot stale data
              return;
            }
          }

          const totalHeld = walletBalance + bankBalance;
          const newTier = getHolderTier(totalHeld);
          const newRank = newTier.rank;
          const oldRank = tierRank(u.holder_tier || "none");
          const tierDropped = newRank < oldRank;
          if (newTier.id !== u.holder_tier) tierChanges++;

          // Streak logic — strict (any drop in rank resets):
          let newSince: string | null;
          const existingSince = u.holder_tier_since
            ? typeof u.holder_tier_since === "string"
              ? u.holder_tier_since
              : new Date(u.holder_tier_since).toISOString()
            : null;

          if (newTier.id === "none") {
            newSince = null;
          } else if (tierDropped || !existingSince) {
            newSince = new Date().toISOString();
          } else {
            newSince = existingSince;
          }

          await sql`
            UPDATE users SET
              holder_tier = ${newTier.id},
              holder_tier_since = ${newSince},
              last_snapshot_at = now(),
              last_snapshot_total = ${totalHeld.toFixed(8)}::numeric,
              updated_at = now()
            WHERE id = ${u.id}
          `;

          await sql`
            INSERT INTO xrge_holder_snapshots
              (user_id, wallet_balance, bank_balance, total_held, tier)
            VALUES (
              ${u.id},
              ${walletBalance.toFixed(8)}::numeric,
              ${bankBalance.toFixed(8)}::numeric,
              ${totalHeld.toFixed(8)}::numeric,
              ${newTier.id}
            )
          `;
          snapshotted++;
        }),
      );

      if (i + RPC_BATCH_SIZE < users.length) {
        await new Promise((r) => setTimeout(r, RPC_BATCH_DELAY_MS));
      }
    }

    // Prune old snapshots
    const pruneResult = await sql`
      DELETE FROM xrge_holder_snapshots
      WHERE taken_at < now() - INTERVAL '30 days'
    `;
    const pruned = (pruneResult as any).count ?? 0;

    const elapsedMs = Date.now() - startedAt;
    const report = {
      ok: true,
      processed,
      snapshotted,
      tierChanges,
      onChainSuccess,
      onChainFailures,
      pruned,
      retentionDays: SNAPSHOT_RETENTION_DAYS,
      elapsedMs,
      timestamp: new Date().toISOString(),
    };
    console.log("[cron-xrge-snapshot]", JSON.stringify(report));
    return res.status(200).json(report);
  } catch (err: any) {
    console.error("[cron-xrge-snapshot] error:", err.message, err.stack);
    return res.status(500).json({
      error: "Snapshot cron failed",
      processed,
      snapshotted,
      tierChanges,
    });
  }
}
