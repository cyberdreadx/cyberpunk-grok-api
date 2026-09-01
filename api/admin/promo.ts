/**
 * /api/admin/promo — review queue for the anti-farm promo.
 *
 * GET  → { config, approvedCount, slotsRemaining, claims[] }
 * POST { claimId, action: "approve" | "reject", reason? }
 *
 * Approving is the only thing in the promo that moves credits. It pays via
 * add_pack_credits() — promo credits are a grant, so pack (non-expiring) is the
 * correct bucket, the same one every other grant uses.
 *
 * Auth: existing admin check (JWT email === ADMIN_EMAIL). No new ADMIN_TOKEN.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "../_lib/auth";
import { applyCors } from "../_lib/cors";
import { getPromoConfig, approvedCount } from "../_lib/promo";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth || auth.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Admin only" });
  }

  const sql = getDb();
  const cfg = await getPromoConfig();

  try {
    if (req.method === "GET") {
      const status = String(req.query.status || "pending");
      const rows = await sql`
        SELECT
          c.id, c.post_url, c.status, c.credits_awarded, c.reject_reason,
          c.created_at, c.decided_at, c.user_id,
          u.email, u.created_at AS account_created_at,
          FLOOR(EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400)::int AS account_age_days,
          (
            SELECT count(*) FROM usage_log l
            WHERE l.user_id = u.id AND l.credits_used > 0
              AND l.mode NOT LIKE '%refunded%'
              AND (l.mode LIKE 'comfy-%' OR l.mode LIKE 'generate-%'
                   OR l.mode LIKE 'edit-%' OR l.mode LIKE 'gltch-edit%')
          )::int AS render_count,
          EXISTS (
            SELECT 1 FROM promo_claims p
            WHERE p.user_id = c.user_id AND p.status = 'approved'
          ) AS already_paid
        FROM promo_claims c
        JOIN users u ON u.id = c.user_id
        WHERE (${status} = 'all' OR c.status = ${status})
        ORDER BY c.created_at ASC
        LIMIT 200
      ` as any[];

      const approved = await approvedCount();
      return res.status(200).json({
        config: cfg,
        approvedCount: approved,
        slotsRemaining: Math.max(0, cfg.maxApproved - approved),
        claims: rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          email: r.email,
          postUrl: r.post_url,
          status: r.status,
          creditsAwarded: r.credits_awarded,
          rejectReason: r.reject_reason,
          createdAt: r.created_at,
          decidedAt: r.decided_at,
          accountCreatedAt: r.account_created_at,
          accountAgeDays: r.account_age_days,
          renderCount: r.render_count,
          alreadyPaid: r.already_paid,
          meetsAge: r.account_age_days >= cfg.minAccountAgeDays,
          meetsRenders: r.render_count >= cfg.minRenders,
        })),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    const { claimId, action, reason } = (req.body || {}) as {
      claimId?: string; action?: string; reason?: string;
    };
    if (!claimId || (action !== "approve" && action !== "reject")) {
      return res.status(400).json({ error: "claimId and action (approve|reject) are required" });
    }

    const [claim] = await sql`
      SELECT id, user_id, status, code_id FROM promo_claims WHERE id = ${claimId}::uuid
    ` as any[];
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (claim.status !== "pending") {
      return res.status(409).json({ error: `Claim is already ${claim.status}.` });
    }

    if (action === "reject") {
      await sql`
        UPDATE promo_claims
        SET status = 'rejected', reject_reason = ${(reason || "").slice(0, 300) || null},
            decided_at = now(), decided_by = ${auth.email}
        WHERE id = ${claimId}::uuid AND status = 'pending'
      `;
      // Give the invite code back so a junk claim doesn't consume a slot.
      if (claim.code_id) {
        await sql`UPDATE promo_codes SET used_by = NULL, used_at = NULL WHERE id = ${claim.code_id}::uuid`;
      }
      return res.status(200).json({ ok: true, status: "rejected" });
    }

    // ── approve ──
    const approved = await approvedCount();
    if (approved >= cfg.maxApproved) {
      return res.status(409).json({ error: `Cap reached — ${approved}/${cfg.maxApproved} already paid.` });
    }

    // Flip to approved FIRST. promo_claims_one_approved_per_user makes this the
    // point where a second payout for the same user becomes impossible, and the
    // `status = 'pending'` guard makes a double-click a no-op. Credits are only
    // added if this UPDATE actually claimed the row, so the money follows the
    // constraint rather than racing it.
    let claimed: any[];
    try {
      claimed = await sql`
        UPDATE promo_claims
        SET status = 'approved', credits_awarded = ${cfg.creditAmount},
            decided_at = now(), decided_by = ${auth.email}
        WHERE id = ${claimId}::uuid AND status = 'pending'
        RETURNING id, user_id
      ` as any[];
    } catch (e: any) {
      if (String(e?.message || "").includes("promo_claims_one_approved_per_user")) {
        return res.status(409).json({ error: "That user has already been paid for this promo." });
      }
      throw e;
    }
    if (claimed.length === 0) {
      return res.status(409).json({ error: "Claim was already decided." });
    }

    await sql`SELECT add_pack_credits(${claim.user_id}::uuid, ${cfg.creditAmount})`;
    await sql`
      INSERT INTO usage_log (user_id, mode, credits_used, prompt)
      VALUES (${claim.user_id}::uuid, 'promo-antifarm-grant', ${-cfg.creditAmount}, 'AntiReddit promo')
    `.catch(() => { });

    const nowApproved = approved + 1;
    return res.status(200).json({
      ok: true,
      status: "approved",
      creditsAwarded: cfg.creditAmount,
      approvedCount: nowApproved,
      slotsRemaining: Math.max(0, cfg.maxApproved - nowApproved),
      promoClosed: nowApproved >= cfg.maxApproved,
    });
  } catch (err: any) {
    console.error("[admin/promo]", err?.message);
    return res.status(500).json({ error: "Request failed." });
  }
}
