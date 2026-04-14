/**
 * POST /api/xrge-unlock
 * Verify an on-chain XRGE payment for a locked post or story.
 * The buyer sends XRGE to the platform deposit address.
 * 80% is credited to the creator's XRGE bank, 20% stays as platform fee.
 *
 * Body: { txHash, postId?, storyId? }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { getXrgeConfig, verifyXrgeTransfer, weiToXrge } from "./_lib/xrge";

export const config = { maxDuration: 60 };

const CREATOR_SHARE = 0.80;
const PLATFORM_SHARE = 0.20;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { txHash, postId, storyId } = req.body || {};
    if (!txHash) return res.status(400).json({ error: "txHash is required" });
    if (!postId && !storyId) return res.status(400).json({ error: "postId or storyId required" });

    const sql = getDb();
    const xrgeConfig = await getXrgeConfig();
    const normalizedHash = txHash.trim().toLowerCase();

    // Check if tx already used
    if (postId) {
      const [dup] = await sql`SELECT id FROM feed_unlocks WHERE xrge_tx_hash = ${normalizedHash}`;
      if (dup) return res.status(400).json({ error: "Transaction already used" });
    }
    if (storyId) {
      const [dup] = await sql`SELECT id FROM story_unlocks WHERE xrge_tx_hash = ${normalizedHash}`;
      if (dup) return res.status(400).json({ error: "Transaction already used" });
    }

    // Get the content and its XRGE price
    let contentOwnerId: string;
    let expectedAmount: string;

    if (postId) {
      const [post] = await sql`SELECT user_id, lock_xrge_amount FROM feed_posts WHERE id = ${postId}::uuid`;
      if (!post) return res.status(404).json({ error: "Post not found" });
      if (!post.lock_xrge_amount || parseFloat(post.lock_xrge_amount) <= 0) {
        return res.status(400).json({ error: "Post has no XRGE lock" });
      }
      if (post.user_id === auth.userId) return res.status(200).json({ ok: true, message: "Own post" });
      // Check already unlocked
      const [existing] = await sql`SELECT id FROM feed_unlocks WHERE post_id = ${postId}::uuid AND user_id = ${auth.userId}::uuid`;
      if (existing) return res.status(200).json({ ok: true, message: "Already unlocked" });
      contentOwnerId = post.user_id;
      expectedAmount = post.lock_xrge_amount;
    } else {
      const [story] = await sql`SELECT user_id, lock_xrge_amount FROM stories WHERE id = ${storyId}::uuid AND expires_at > now()`;
      if (!story) return res.status(404).json({ error: "Story not found or expired" });
      if (!story.lock_xrge_amount || parseFloat(story.lock_xrge_amount) <= 0) {
        return res.status(400).json({ error: "Story has no XRGE lock" });
      }
      if (story.user_id === auth.userId) return res.status(200).json({ ok: true, message: "Own story" });
      const [existing] = await sql`SELECT id FROM story_unlocks WHERE story_id = ${storyId}::uuid AND user_id = ${auth.userId}::uuid`;
      if (existing) return res.status(200).json({ ok: true, message: "Already unlocked" });
      contentOwnerId = story.user_id;
      expectedAmount = story.lock_xrge_amount;
    }

    // Verify on-chain transfer to platform deposit address
    const transfer = await verifyXrgeTransfer(txHash, expectedAmount, xrgeConfig.depositAddress, xrgeConfig.rpcUrl);
    const paidAmount = parseFloat(weiToXrge(transfer.amountWei));

    // Revenue split
    const creatorAmount = (paidAmount * CREATOR_SHARE).toFixed(4);
    const platformAmount = (paidAmount * PLATFORM_SHARE).toFixed(4);

    // Record unlock + credit creator's XRGE bank atomically
    if (postId) {
      await sql`
        INSERT INTO feed_unlocks (post_id, user_id, unlock_method, xrge_paid, xrge_tx_hash)
        VALUES (${postId}::uuid, ${auth.userId}::uuid, 'xrge', ${expectedAmount}, ${normalizedHash})
        ON CONFLICT (post_id, user_id) DO NOTHING
      `;
    } else {
      await sql`
        INSERT INTO story_unlocks (story_id, user_id, credits_paid, xrge_paid, xrge_tx_hash)
        VALUES (${storyId}::uuid, ${auth.userId}::uuid, 0, ${expectedAmount}, ${normalizedHash})
        ON CONFLICT (story_id, user_id) DO NOTHING
      `;
    }

    // Credit creator's XRGE bank balance (80%)
    await sql`
      UPDATE users
      SET xrge_bank_balance = COALESCE(xrge_bank_balance, 0) + ${creatorAmount}::numeric,
          updated_at = now()
      WHERE id = ${contentOwnerId}
    `;

    // Log the transaction for the creator
    await sql`
      INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, tx_hash, metadata)
      VALUES (
        ${contentOwnerId}, 'creator_earning', ${creatorAmount}::numeric,
        (SELECT COALESCE(xrge_bank_balance, 0) FROM users WHERE id = ${contentOwnerId}),
        ${normalizedHash},
        ${JSON.stringify({
          from: transfer.from,
          unlockType: postId ? 'post' : 'story',
          contentId: postId || storyId,
          totalPaid: paidAmount,
          creatorShare: parseFloat(creatorAmount),
          platformShare: parseFloat(platformAmount),
        })}::jsonb
      )
    `;

    console.log(`[xrge-unlock] ${paidAmount} XRGE paid for ${postId ? 'post' : 'story'} ${postId || storyId}. Creator ${contentOwnerId} gets ${creatorAmount} XRGE`);

    return res.status(200).json({
      ok: true,
      paid: paidAmount,
      creatorEarned: parseFloat(creatorAmount),
      platformFee: parseFloat(platformAmount),
    });
  } catch (err: any) {
    console.error("[xrge-unlock]", err.message);
    const safeMessages = ["Invalid transaction hash", "Transaction not found", "Transaction failed", "confirmation", "No XRGE transfer", "not sent to the correct", "Insufficient amount"];
    const isSafe = safeMessages.some(m => err.message?.includes(m));
    return res.status(400).json({ error: isSafe ? err.message : "XRGE unlock verification failed" });
  }
}
