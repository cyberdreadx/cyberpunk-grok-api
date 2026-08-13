/**
 * /api/ambassador — ambassador program, user-facing side.
 *
 * POST { action: "apply" }       — submit an application (auth)
 * POST { action: "mine" }        — own status: application + ambassador record (auth)
 * POST { action: "stats" }       — earnings dashboard (auth, ambassadors only)
 * POST { action: "referees" }    — attributed customers, identity masked (auth)
 * POST { action: "commissions" } — commission ledger (auth)
 * POST { action: "track" }       — record a link click (public)
 *
 * Admin review lives in /api/admin so it sits behind the same gate as every
 * other admin action.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { checkRateLimit, getClientIp } from "./_lib/ratelimit";
import {
  normalizeCode,
  validateCode,
  isCodeAvailable,
  visitorHash,
} from "./_lib/ambassador";

/** Mask an email for the ambassador's own dashboard — never the full address. */
function maskEmail(email: string): string {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return "anonymous";
  return `${(local || "?").slice(0, 2)}***@${domain}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const sql = getDb();
  const body = (req.body || {}) as Record<string, any>;
  const action = String(body.action || "");

  try {
    // ── Public: click tracking ───────────────────────────────────────
    // Deliberately before the auth gate — most link clicks are logged-out.
    if (action === "track") {
      const code = normalizeCode(body.code);
      if (!code) return res.status(200).json({ ok: false });

      const ip = getClientIp(req);
      const { allowed } = await checkRateLimit(`ambclick:${ip}`, "ambassador-track", {
        max: 60,
        windowSeconds: 60,
      });
      if (!allowed) return res.status(200).json({ ok: false });

      const hash = visitorHash(ip, String(req.headers["user-agent"] || ""));
      const [row] = await sql`
        WITH amb AS (
          SELECT id FROM ambassadors WHERE LOWER(code) = LOWER(${code}) AND status = 'active'
        ), seen AS (
          INSERT INTO ambassador_click_seen (ambassador_id, day, visitor_hash)
          SELECT id, CURRENT_DATE, ${hash} FROM amb
          ON CONFLICT DO NOTHING
          RETURNING 1
        ), day AS (
          INSERT INTO ambassador_click_days (ambassador_id, day, clicks, uniques)
          SELECT id, CURRENT_DATE, 1, (SELECT COUNT(*) FROM seen)::int FROM amb
          ON CONFLICT (ambassador_id, day) DO UPDATE
            SET clicks = ambassador_click_days.clicks + 1,
                uniques = ambassador_click_days.uniques + EXCLUDED.uniques
          RETURNING 1
        )
        SELECT EXISTS(SELECT 1 FROM amb) AS ok
      `;
      return res.status(200).json({ ok: !!row?.ok });
    }

    // ── Everything below needs a session ─────────────────────────────
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { allowed } = await checkRateLimit(auth.userId, "ambassador", { max: 40, windowSeconds: 60 });
    if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

    switch (action) {
      // ── Own status ─────────────────────────────────────────────────
      case "mine": {
        const [amb] = await sql`
          SELECT id, code, display_name, status, commission_pct, commission_months,
                 hold_days, tier, lifetime_gross_cents, lifetime_commission_cents, approved_at
          FROM ambassadors WHERE user_id = ${auth.userId}::uuid
        `;
        const [app] = await sql`
          SELECT id, status, requested_code, admin_notes, created_at, reviewed_at
          FROM ambassador_applications
          WHERE user_id = ${auth.userId}::uuid
          ORDER BY created_at DESC LIMIT 1
        `;
        return res.status(200).json({
          ambassador: amb
            ? {
                code: amb.code,
                displayName: amb.display_name,
                status: amb.status,
                commissionPct: Number(amb.commission_pct),
                commissionMonths: amb.commission_months,
                holdDays: amb.hold_days,
                tier: amb.tier,
                lifetimeGrossCents: Number(amb.lifetime_gross_cents),
                lifetimeCommissionCents: Number(amb.lifetime_commission_cents),
                approvedAt: amb.approved_at,
              }
            : null,
          application: app
            ? {
                status: app.status,
                requestedCode: app.requested_code,
                // Notes are shown to the applicant, so rejections should be
                // written as feedback rather than internal shorthand.
                adminNotes: app.admin_notes,
                createdAt: app.created_at,
                reviewedAt: app.reviewed_at,
              }
            : null,
        });
      }

      // ── Apply ──────────────────────────────────────────────────────
      case "apply": {
        const [existing] = await sql`
          SELECT id FROM ambassadors WHERE user_id = ${auth.userId}::uuid
        `;
        if (existing) return res.status(409).json({ error: "You're already an ambassador" });

        const [pending] = await sql`
          SELECT id FROM ambassador_applications
          WHERE user_id = ${auth.userId}::uuid AND status = 'pending'
        `;
        if (pending) return res.status(409).json({ error: "Your application is already under review" });

        const requestedCode = normalizeCode(body.requestedCode);
        if (requestedCode) {
          const bad = validateCode(requestedCode);
          if (bad) return res.status(400).json({ error: bad });
          if (!(await isCodeAvailable(sql, requestedCode))) {
            return res.status(409).json({ error: "That code is already taken" });
          }
        }

        const pitch = String(body.pitch || "").trim();
        if (pitch.length < 30) {
          return res.status(400).json({ error: "Tell us a bit more — at least 30 characters" });
        }

        // Socials arrive as { platform: url }; keep it small and stringy.
        const socialsRaw = body.socials && typeof body.socials === "object" ? body.socials : {};
        const socials: Record<string, string> = {};
        for (const [k, v] of Object.entries(socialsRaw).slice(0, 8)) {
          if (typeof v === "string" && v.trim()) socials[String(k).slice(0, 32)] = v.trim().slice(0, 300);
        }

        const audience = Number.isFinite(Number(body.audienceSize))
          ? Math.max(0, Math.min(1_000_000_000, Math.floor(Number(body.audienceSize))))
          : null;

        const [row] = await sql`
          INSERT INTO ambassador_applications
            (user_id, email, requested_code, display_name, country, socials,
             audience_size, channels, pitch, payout_pref)
          VALUES
            (${auth.userId}::uuid, ${auth.email}, ${requestedCode || null},
             ${String(body.displayName || "").slice(0, 80) || null},
             ${String(body.country || "").slice(0, 60) || null},
             ${JSON.stringify(socials)}::jsonb, ${audience},
             ${String(body.channels || "").slice(0, 500) || null},
             ${pitch.slice(0, 4000)},
             ${String(body.payoutPref || "").slice(0, 40) || null})
          RETURNING id, created_at
        `;
        return res.status(201).json({ id: row.id, createdAt: row.created_at, status: "pending" });
      }

      // ── Earnings dashboard ─────────────────────────────────────────
      case "stats": {
        const [amb] = await sql`
          SELECT id, code, status, commission_pct, commission_months, hold_days
          FROM ambassadors WHERE user_id = ${auth.userId}::uuid
        `;
        if (!amb) return res.status(403).json({ error: "Not an ambassador", code: "NOT_AMBASSADOR" });

        const [funnel] = await sql`
          SELECT
            COUNT(*)::int AS signups,
            COUNT(*) FILTER (WHERE first_paid_at IS NOT NULL)::int AS converted,
            COUNT(*) FILTER (WHERE disqualified)::int AS disqualified,
            COUNT(*) FILTER (
              WHERE disqualified = false
                AND (commission_until IS NULL OR commission_until > now())
            )::int AS earning,
            COALESCE(SUM(gross_cents), 0)::bigint AS gross_cents
          FROM ambassador_referrals WHERE ambassador_id = ${amb.id}::uuid
        `;

        // 'available' means released into cash_balance_cents — the withdrawable
        // figure lives on users, since payouts draw it down from there.
        const [money] = await sql`
          SELECT
            COALESCE(SUM(commission_cents) FILTER (WHERE status = 'pending'), 0)::bigint     AS pending_cents,
            COALESCE(SUM(commission_cents) FILTER (WHERE status = 'available'), 0)::bigint   AS released_cents,
            COALESCE(SUM(commission_cents) FILTER (WHERE status = 'clawed_back'), 0)::bigint AS clawed_cents,
            COUNT(*) FILTER (WHERE status = 'pending')::int                                  AS pending_count,
            MIN(available_at) FILTER (WHERE status = 'pending')                              AS next_release_at
          FROM ambassador_commissions WHERE ambassador_id = ${amb.id}::uuid
        `;

        const [cash] = await sql`
          SELECT COALESCE(cash_balance_cents, 0)::int AS cash FROM users WHERE id = ${auth.userId}::uuid
        `;

        const clicks = await sql`
          SELECT day::text AS day, clicks, uniques
          FROM ambassador_click_days
          WHERE ambassador_id = ${amb.id}::uuid AND day >= CURRENT_DATE - INTERVAL '90 days'
          ORDER BY day
        `;

        const [clickTotals] = await sql`
          SELECT COALESCE(SUM(clicks), 0)::int AS clicks, COALESCE(SUM(uniques), 0)::int AS uniques
          FROM ambassador_click_days WHERE ambassador_id = ${amb.id}::uuid
        `;

        // Monthly earnings series, gap-filled so the chart doesn't lie about
        // quiet months by simply skipping them.
        const series = await sql`
          WITH months AS (
            SELECT generate_series(
              date_trunc('month', now()) - INTERVAL '11 months',
              date_trunc('month', now()),
              INTERVAL '1 month'
            ) AS bucket
          )
          SELECT m.bucket::text AS bucket,
                 COALESCE(SUM(c.commission_cents) FILTER (WHERE c.status <> 'clawed_back'), 0)::int AS commission_cents,
                 COALESCE(SUM(c.gross_cents) FILTER (WHERE c.status <> 'clawed_back'), 0)::int      AS gross_cents
          FROM months m
          LEFT JOIN ambassador_commissions c
            ON date_trunc('month', c.created_at) = m.bucket
           AND c.ambassador_id = ${amb.id}::uuid
          GROUP BY m.bucket ORDER BY m.bucket
        `;

        const uniques = clickTotals?.uniques || 0;
        return res.status(200).json({
          code: amb.code,
          status: amb.status,
          commissionPct: Number(amb.commission_pct),
          commissionMonths: amb.commission_months,
          holdDays: amb.hold_days,
          signups: funnel?.signups || 0,
          converted: funnel?.converted || 0,
          earning: funnel?.earning || 0,
          disqualified: funnel?.disqualified || 0,
          attributedGrossCents: Number(funnel?.gross_cents || 0),
          pendingCents: Number(money?.pending_cents || 0),
          releasedCents: Number(money?.released_cents || 0),
          clawedBackCents: Number(money?.clawed_cents || 0),
          pendingCount: money?.pending_count || 0,
          nextReleaseAt: money?.next_release_at || null,
          withdrawableCents: cash?.cash || 0,
          clicks: clickTotals?.clicks || 0,
          uniqueClicks: uniques,
          conversionPct: uniques > 0 ? ((funnel?.converted || 0) / uniques) * 100 : 0,
          clickSeries: clicks,
          earningsSeries: series,
        });
      }

      // ── Attributed customers ───────────────────────────────────────
      case "referees": {
        const [amb] = await sql`SELECT id FROM ambassadors WHERE user_id = ${auth.userId}::uuid`;
        if (!amb) return res.status(403).json({ error: "Not an ambassador", code: "NOT_AMBASSADOR" });

        const rows = await sql`
          SELECT r.attributed_at, r.commission_until, r.first_paid_at, r.gross_cents,
                 r.commission_cents, r.disqualified, p.username, u.email
          FROM ambassador_referrals r
          LEFT JOIN users u ON u.id = r.user_id
          LEFT JOIN profiles p ON p.user_id = r.user_id
          WHERE r.ambassador_id = ${amb.id}::uuid
          ORDER BY r.gross_cents DESC, r.attributed_at DESC
          LIMIT 250
        `;
        return res.status(200).json({
          referees: rows.map((r: any) => ({
            name: r.username || (r.email ? maskEmail(r.email) : "deleted account"),
            joinedAt: r.attributed_at,
            commissionUntil: r.commission_until,
            firstPaidAt: r.first_paid_at,
            grossCents: Number(r.gross_cents),
            commissionCents: Number(r.commission_cents),
            // Surfaced so an ambassador can see a signup was rejected, but the
            // reason stays internal — it would just teach people the checks.
            disqualified: !!r.disqualified,
          })),
        });
      }

      // ── Commission ledger ──────────────────────────────────────────
      case "commissions": {
        const [amb] = await sql`SELECT id FROM ambassadors WHERE user_id = ${auth.userId}::uuid`;
        if (!amb) return res.status(403).json({ error: "Not an ambassador", code: "NOT_AMBASSADOR" });

        const rows = await sql`
          SELECT c.id, c.source_kind, c.gross_cents, c.commission_pct, c.commission_cents,
                 c.status, c.available_at, c.released_at, c.created_at,
                 COALESCE(p.username, LEFT(u.email, 2) || '***') AS customer
          FROM ambassador_commissions c
          LEFT JOIN users u ON u.id = c.user_id
          LEFT JOIN profiles p ON p.user_id = c.user_id
          WHERE c.ambassador_id = ${amb.id}::uuid
          ORDER BY c.created_at DESC
          LIMIT 200
        `;
        return res.status(200).json({
          commissions: rows.map((r: any) => ({
            id: r.id,
            kind: r.source_kind,
            customer: r.customer || "deleted account",
            grossCents: r.gross_cents,
            pct: Number(r.commission_pct),
            commissionCents: r.commission_cents,
            status: r.status,
            availableAt: r.available_at,
            releasedAt: r.released_at,
            createdAt: r.created_at,
          })),
        });
      }

      default:
        return res.status(400).json({
          error: "Unknown action. Expected: apply, mine, stats, referees, commissions, track",
        });
    }
  } catch (err: any) {
    console.error("[ambassador]", err?.message);
    return res.status(500).json({ error: "Ambassador request failed" });
  }
}
