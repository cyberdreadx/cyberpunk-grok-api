/**
 * /api/promo-claim — the claimant side of the anti-farm promo.
 *
 * GET  → { open, slotsRemaining, eligible, reasons, myClaim, requireCode, creditAmount }
 * POST { postUrl, code? } → creates a pending claim. Never pays.
 *
 * Auth: Bearer JWT (must be logged into GLTCH). There is no cookie session, so
 * a cross-site form cannot attach the token and CSRF is not reachable here —
 * that is why there is no CSRF token to check.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, checkBan } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { checkRateLimit } from "./_lib/ratelimit";
import {
  getPromoConfig,
  getEligibility,
  approvedCount,
  normalizePostUrl,
  hashCode,
} from "./_lib/promo";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Sign in to claim." });

  const sql = getDb();
  const cfg = await getPromoConfig();

  try {
    const [approved, eligibility] = await Promise.all([
      approvedCount(),
      getEligibility(auth.userId, cfg),
    ]);
    const slotsRemaining = Math.max(0, cfg.maxApproved - approved);
    const open = cfg.enabled && slotsRemaining > 0;

    const [mine] = await sql`
      SELECT id, post_url, status, credits_awarded, reject_reason, created_at, decided_at
      FROM promo_claims WHERE user_id = ${auth.userId}::uuid
      ORDER BY created_at DESC LIMIT 1
    ` as any[];

    const myClaim = mine
      ? {
        id: mine.id,
        postUrl: mine.post_url,
        status: mine.status,
        creditsAwarded: mine.credits_awarded,
        rejectReason: mine.reject_reason,
        createdAt: mine.created_at,
        decidedAt: mine.decided_at,
      }
      : null;

    if (req.method === "GET") {
      return res.status(200).json({
        open,
        slotsRemaining,
        creditAmount: cfg.creditAmount,
        requireCode: cfg.requireCode,
        minAccountAgeDays: cfg.minAccountAgeDays,
        minRenders: cfg.minRenders,
        eligible: eligibility.eligible,
        reasons: eligibility.reasons,
        accountAgeDays: eligibility.accountAgeDays,
        renderCount: eligibility.renderCount,
        myClaim,
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    // Rule: 3 claim attempts per user per day. Counted before any validation so
    // that probing for a valid code costs the same as a real attempt.
    const { allowed } = await checkRateLimit(
      `promo:${auth.userId}`, "promo-claim", { max: 3, windowSeconds: 86400 },
    );
    if (!allowed) {
      return res.status(429).json({ error: "Too many attempts today. Try again tomorrow." });
    }

    const { banned } = await checkBan(sql as any, auth.userId);
    if (banned) return res.status(403).json({ error: "This account cannot claim the promo." });

    if (!cfg.enabled) return res.status(403).json({ error: "The promo is closed." });
    if (slotsRemaining <= 0) return res.status(403).json({ error: "All 20 spots are taken." });
    if (!eligibility.eligible) {
      return res.status(403).json({ error: eligibility.reasons[0], reasons: eligibility.reasons });
    }

    const body = (req.body || {}) as { postUrl?: string; code?: string };
    const postUrlNorm = normalizePostUrl(body.postUrl || "");
    if (!postUrlNorm) {
      return res.status(400).json({ error: "Paste a full AntiReddit post link (antireddit.com/...)." });
    }

    // Optional single-use invite code. Claimed here rather than at approval so
    // a code cannot be spent by two people while one claim sits pending; a
    // rejection releases it (see api/admin/promo.ts).
    let codeId: string | null = null;
    if (cfg.requireCode) {
      const raw = (body.code || "").trim();
      if (!raw) return res.status(400).json({ error: "An invite code is required." });
      const [row] = await sql`
        UPDATE promo_codes
        SET used_by = ${auth.userId}::uuid, used_at = now()
        WHERE code_hash = ${hashCode(raw)} AND used_by IS NULL
        RETURNING id
      ` as any[];
      if (!row) return res.status(400).json({ error: "That code is invalid or already used." });
      codeId = row.id;
    }

    try {
      const [claim] = await sql`
        INSERT INTO promo_claims (user_id, post_url, post_url_norm, code_id)
        VALUES (${auth.userId}::uuid, ${(body.postUrl || "").trim().slice(0, 500)},
                ${postUrlNorm}, ${codeId})
        RETURNING id, status, created_at
      ` as any[];
      return res.status(201).json({
        ok: true,
        claim: { id: claim.id, status: claim.status, createdAt: claim.created_at },
        slotsRemaining,
      });
    } catch (e: any) {
      // Release the code so a rejected insert doesn't burn a slot.
      if (codeId) {
        await sql`UPDATE promo_codes SET used_by = NULL, used_at = NULL WHERE id = ${codeId}::uuid`
          .catch(() => { });
      }
      const msg = String(e?.message || "");
      // The partial unique indexes from migration 061 are the real enforcement;
      // translate each into something a person can act on.
      if (msg.includes("promo_claims_one_approved_per_user")) {
        return res.status(409).json({ error: "This account already received the promo." });
      }
      if (msg.includes("promo_claims_one_pending_per_user")) {
        return res.status(409).json({ error: "You already have a claim waiting for review." });
      }
      if (msg.includes("promo_claims_unique_post")) {
        return res.status(409).json({ error: "That post has already been claimed." });
      }
      throw e;
    }
  } catch (err: any) {
    console.error("[promo-claim]", err?.message);
    return res.status(500).json({ error: "Could not submit the claim." });
  }
}
