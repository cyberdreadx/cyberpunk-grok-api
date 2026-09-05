/**
 * GET    /api/v1/xrge-wallet?address=0x…  — request a signing challenge
 * POST   /api/v1/xrge-wallet              — bind/update XRGE wallet (signature required)
 * DELETE /api/v1/xrge-wallet              — unbind wallet
 *
 * Updates BOTH users.wallet_address (for bank/snapshots) and
 * profiles.wallet_address (for creator XRGE payouts) so they stay in sync.
 *
 * On successful POST, performs an inline fresh snapshot so the user
 * sees their holder tier immediately (no need to wait 24h for the cron).
 *
 * Binding requires proving control of the address. It used to accept any
 * well-formed 0x string, which meant pasting a public whale address from
 * Basescan bought you Architect tier — a 25% discount and +10 daily credits —
 * for nothing. Callers must now GET a nonce, sign it, and POST the signature.
 *
 * Auth: X-API-Key or Authorization: Bearer JWT.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { getXrgeBalanceOnChain, weiToXrge } from "../_lib/xrge";
import { getHolderTier, tierRank } from "./_lib/xrge-holder";
import { invalidateDiscount } from "../_lib/discount";
import {
  issueWalletChallenge,
  consumeWalletChallenge,
  verifyWalletSignature,
  normalizeAddress,
} from "./_lib/wallet-verify";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKeyAuth = await getUserFromApiKey(req);
  const jwtAuth = !apiKeyAuth ? getUserFromRequest(req) : null;
  const userId = apiKeyAuth?.userId || jwtAuth?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();

  // ── GET — issue a signing challenge ───────────────────────────────────
  if (req.method === "GET") {
    const address = normalizeAddress(req.query.address);
    if (!address) {
      return res.status(400).json({ error: "Invalid wallet address (must be 0x + 40 hex chars)" });
    }
    try {
      const challenge = await issueWalletChallenge(sql, userId, address);
      return res.status(200).json(challenge);
    } catch (err: any) {
      console.error("[xrge-wallet GET]", err.message);
      return res.status(500).json({ error: "Failed to create challenge" });
    }
  }

  // ── DELETE — unbind wallet ────────────────────────────────────────────
  if (req.method === "DELETE") {
    try {
      await sql`UPDATE users SET wallet_address = NULL, wallet_verified_at = NULL, updated_at = now() WHERE id = ${userId}`;
      await sql`UPDATE profiles SET wallet_address = NULL, wallet_verified_at = NULL, updated_at = now() WHERE user_id = ${userId}`;
      await sql`DELETE FROM wallet_challenges WHERE user_id = ${userId}`.catch(() => {});
      invalidateDiscount(userId);
      return res.status(200).json({ success: true, walletAddress: null });
    } catch (err: any) {
      console.error("[xrge-wallet DELETE]", err.message);
      return res.status(500).json({ error: "Failed to unbind wallet" });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST or DELETE only" });

  // ── POST — bind/update wallet ─────────────────────────────────────────
  const { walletAddress, signature, nonce } = req.body || {};
  if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });

  const clean = normalizeAddress(walletAddress);
  if (!clean) {
    return res.status(400).json({ error: "Invalid wallet address (must be 0x + 40 hex chars)" });
  }
  if (!signature || !nonce) {
    return res.status(400).json({
      error: "Signature required — request a challenge from GET /api/v1/xrge-wallet first",
      code: "signature_required",
    });
  }

  try {
    // Sybil-resistance: refuse if another user owns this wallet. Checked before
    // burning the nonce so a rejected bind can be retried against a free address.
    const existing = await sql`
      SELECT id FROM users WHERE LOWER(wallet_address) = ${clean} AND id != ${userId}
      LIMIT 1
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: "This wallet is already bound to another account" });
    }

    // Single-use: the nonce is spent whether or not the signature turns out to be
    // valid, so a wrong guess can't be retried against the same challenge.
    const message = await consumeWalletChallenge(sql, userId, clean, String(nonce));
    if (!message) {
      return res.status(400).json({
        error: "Challenge expired or already used — request a new one and sign again",
        code: "challenge_invalid",
      });
    }

    const proven = await verifyWalletSignature(clean, message, String(signature));
    if (!proven) {
      console.warn(`[xrge-wallet] rejected bind of ${clean} by user ${userId}: bad signature`);
      return res.status(401).json({
        error: "Signature does not match this wallet address",
        code: "signature_invalid",
      });
    }

    await sql`
      UPDATE users
         SET wallet_address = ${clean}, wallet_verified_at = now(), updated_at = now()
       WHERE id = ${userId}
    `;
    await sql`
      INSERT INTO profiles (user_id, wallet_address, wallet_verified_at, updated_at)
      VALUES (${userId}, ${clean}, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET
        wallet_address = ${clean},
        wallet_verified_at = now(),
        updated_at = now()
    `;

    // ── Inline snapshot so the user sees their tier immediately ────────
    let snapshotResult: {
      walletBalance: number;
      bankBalance: number;
      totalHeld: number;
      tier: string;
      tierName: string;
    } | null = null;

    try {
      const wei = await getXrgeBalanceOnChain(clean);
      const walletBalance = parseFloat(weiToXrge(wei));

      const [userRow] = await sql`
        SELECT xrge_bank_balance, holder_tier, holder_tier_since
        FROM users WHERE id = ${userId}
      `;
      const bankBalance = parseFloat(userRow?.xrge_bank_balance) || 0;
      const totalHeld = walletBalance + bankBalance;
      const newTier = getHolderTier(totalHeld);

      const oldRank = tierRank(userRow?.holder_tier || "none");
      const tierDropped = newTier.rank < oldRank;
      const existingSince = userRow?.holder_tier_since
        ? typeof userRow.holder_tier_since === "string"
          ? userRow.holder_tier_since
          : new Date(userRow.holder_tier_since).toISOString()
        : null;

      let newSince: string | null;
      if (newTier.id === "none") newSince = null;
      else if (tierDropped || !existingSince) newSince = new Date().toISOString();
      else newSince = existingSince;

      await sql`
        UPDATE users SET
          holder_tier = ${newTier.id},
          holder_tier_since = ${newSince},
          last_snapshot_at = now(),
          last_snapshot_total = ${totalHeld.toFixed(8)}::numeric,
          updated_at = now()
        WHERE id = ${userId}
      `;
      await sql`
        INSERT INTO xrge_holder_snapshots
          (user_id, wallet_balance, bank_balance, total_held, tier)
        VALUES (
          ${userId},
          ${walletBalance.toFixed(8)}::numeric,
          ${bankBalance.toFixed(8)}::numeric,
          ${totalHeld.toFixed(8)}::numeric,
          ${newTier.id}
        )
      `;

      snapshotResult = {
        walletBalance,
        bankBalance,
        totalHeld,
        tier: newTier.id,
        tierName: newTier.name,
      };
      invalidateDiscount(userId);
    } catch (snapErr: any) {
      // Snapshot failure is non-fatal — the daily cron will catch up.
      console.warn("[xrge-wallet] inline snapshot failed:", snapErr?.message);
    }

    return res.status(200).json({
      success: true,
      walletAddress: clean,
      snapshot: snapshotResult,
    });
  } catch (err: any) {
    console.error("[xrge-wallet POST]", err.message);
    return res.status(500).json({ error: "Failed to bind wallet" });
  }
}
