/**
 * /api/cron-lifecycle — behaviour-triggered email, every 15 minutes.
 *
 * Three flows, all owned by api/_lib/lifecycle.ts (eligibility, caps, cooldowns,
 * claim-before-send):
 *
 *   cart_recovery  a checkout was started and abandoned. Stripe's own session is
 *                  dead within 24h, so each email carries a freshly minted one.
 *   empty_tank     balance hit zero while the person is still creating.
 *   winback        bought before, quiet for 30-60 days.
 *
 * Starts DISABLED. app_config.lifecycle_emails must say enabled:true, and while
 * dryRun is true it reports what it would send and sends nothing.
 *
 * Secured with CRON_SECRET like the other crons.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";
import {
  readLifecycleConfig,
  filterEligible,
  sendLifecycle,
  emptyTankCandidates,
  winbackCandidates,
  FLOW_SUBJECTS,
  type Candidate,
} from "./_lib/lifecycle";
import { buildCartRecoveryHtml, buildEmptyTankHtml, buildWinbackHtml } from "./_lib/email";

const SITE_URL = process.env.APP_URL || "https://grokrunner.gltch.app";

/** An abandoned checkout, with everything needed to rebuild it. */
interface AbandonedCart extends Candidate {
  sessionId: string;
  priceId: string;
  mode: "payment" | "subscription";
  amountUsd: string;
  credits: number | null;
  label: string;
  ageHours: number;
  metadata: Record<string, string>;
}

async function findAbandonedCarts(stripe: Stripe, sql: ReturnType<typeof getDb>): Promise<AbandonedCart[]> {
  const now = Math.floor(Date.now() / 1000);
  const list = await stripe.checkout.sessions.list({
    limit: 100,
    created: { gte: now - 72 * 3600, lte: now - 3600 },
  });

  const carts: AbandonedCart[] = [];
  for (const s of list.data) {
    if (s.status === "complete" || s.payment_status === "paid") continue;
    const userId = (s.metadata?.user_id as string) || (s.client_reference_id as string) || "";
    if (!userId) continue;

    // They may have finished a different session since; never chase a paid customer.
    const paidSince = (await sql`
      SELECT 1 FROM transactions
      WHERE user_id = ${userId}::uuid AND amount_cents > 0
        AND created_at > to_timestamp(${s.created}) LIMIT 1`) as any[];
    if (paidSince.length > 0) continue;

    const [u] = (await sql`SELECT email FROM users WHERE id = ${userId}::uuid`) as any[];
    const email = u?.email || s.customer_details?.email;
    if (!email) continue;

    let priceId = "";
    try {
      const full = await stripe.checkout.sessions.retrieve(s.id, { expand: ["line_items"] });
      priceId = (full.line_items?.data?.[0]?.price?.id as string) || "";
    } catch { /* a session we cannot rebuild is a session we do not chase */ }
    if (!priceId) continue;

    const credits = s.metadata?.credits ? Number(s.metadata.credits) : null;
    carts.push({
      id: userId,
      email: String(email),
      ref: s.id,
      sessionId: s.id,
      priceId,
      mode: s.mode === "subscription" ? "subscription" : "payment",
      amountUsd: ((s.amount_total ?? 0) / 100).toFixed(2),
      credits: Number.isFinite(credits) ? credits : null,
      label: (s.metadata?.package as string) || (s.metadata?.type as string) || "credit pack",
      ageHours: (now - s.created) / 3600,
      metadata: (s.metadata as Record<string, string>) || {},
    });
  }
  return carts;
}

/** The original link is dead or dying; give them a live one. */
async function mintResumeUrl(stripe: Stripe, cart: AbandonedCart): Promise<string | null> {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: cart.mode,
      line_items: [{ price: cart.priceId, quantity: 1 }],
      client_reference_id: cart.id,
      customer_email: cart.email,
      metadata: { ...cart.metadata, user_id: cart.id, recovered_from: cart.sessionId },
      success_url: `${SITE_URL}?checkout=success`,
      cancel_url: `${SITE_URL}?checkout=cancelled`,
    });
    return session.url ?? null;
  } catch (err: any) {
    console.error("[cron-lifecycle] could not mint resume url:", err?.message);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers["authorization"] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sql = getDb();
  const cfg = await readLifecycleConfig(sql);
  const report: Record<string, { candidates: number; eligible: number; sent: number }> = {};
  let budget = cfg.maxPerRun;

  if (!cfg.enabled) {
    return res.status(200).json({ success: true, enabled: false, message: "Lifecycle email is switched off" });
  }

  const run = async (
    flow: Parameters<typeof sendLifecycle>[1],
    candidates: Candidate[],
    render: (c: Candidate) => Promise<string | null> | string | null,
    opts: { skipGlobalCooldown?: boolean } = {},
  ) => {
    const eligible = await filterEligible(sql, flow, candidates, opts);
    const take = eligible.slice(0, Math.max(budget, 0));
    let sent = 0;
    for (const c of take) {
      if (cfg.dryRun) { sent++; budget--; continue; }
      const html = await render(c);
      if (!html) continue;
      if (await sendLifecycle(sql, flow, c, html, FLOW_SUBJECTS[flow])) { sent++; budget--; }
    }
    report[flow] = { candidates: candidates.length, eligible: eligible.length, sent };
  };

  try {
    // ── abandoned checkouts ──
    if (cfg.flows.cart_recovery && process.env.STRIPE_SECRET_KEY) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const carts = await findAbandonedCarts(stripe, sql);

      const first = carts.filter((c) => c.ageHours >= 1 && c.ageHours < 20);
      await run("cart_recovery_1", first, async (c) => {
        const cart = c as AbandonedCart;
        const url = cfg.dryRun ? "#" : await mintResumeUrl(stripe, cart);
        return url ? buildCartRecoveryHtml({
          resumeUrl: url, itemLabel: cart.label, credits: cart.credits, priceUsd: cart.amountUsd, second: false,
        }) : null;
      });

      // The follow-up only exists for carts that already got the first email.
      const firstSent = new Set(
        ((await sql`
          SELECT ref FROM lifecycle_sends
          WHERE flow = 'cart_recovery_1' AND sent_at > now() - interval '4 days'`) as any[]).map((r) => String(r.ref)),
      );
      const second = carts.filter((c) => c.ageHours >= 20 && firstSent.has(c.sessionId));
      await run("cart_recovery_2", second, async (c) => {
        const cart = c as AbandonedCart;
        const url = cfg.dryRun ? "#" : await mintResumeUrl(stripe, cart);
        return url ? buildCartRecoveryHtml({
          resumeUrl: url, itemLabel: cart.label, credits: cart.credits, priceUsd: cart.amountUsd, second: true,
        }) : null;
      }, { skipGlobalCooldown: true });
    }

    // ── ran out of credits ──
    if (cfg.flows.empty_tank && budget > 0) {
      const cands = await emptyTankCandidates(sql, 500);
      await run("empty_tank", cands, (c) => buildEmptyTankHtml({ recentJobs: Number(c.meta?.recentJobs ?? 0) }));
    }

    // ── gone quiet after paying ──
    if (cfg.flows.winback && budget > 0) {
      const cands = await winbackCandidates(sql, 500);
      await run("winback", cands, (c) => buildWinbackHtml({
        creditsLeft: Number(c.meta?.creditsLeft ?? 0),
        wasSubscriber: c.meta?.wasSubscriber === true,
      }));
    }

    const total = Object.values(report).reduce((a, r) => a + r.sent, 0);
    console.log(`[cron-lifecycle] ${cfg.dryRun ? "DRY RUN " : ""}${total} sent ${JSON.stringify(report)}`);
    return res.status(200).json({ success: true, enabled: true, dryRun: cfg.dryRun, sent: total, flows: report });
  } catch (err: any) {
    console.error("[cron-lifecycle] error:", err?.message);
    return res.status(500).json({ error: err?.message || "Lifecycle run failed" });
  }
}
