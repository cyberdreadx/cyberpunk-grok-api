import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";
import { fetchXrgePrice } from "./_lib/xrge";
import { isVerified, VERIFICATION_REQUIRED_MESSAGE } from "./_lib/verifiedGate";
import { sendPayoutRequestedAdminEmail, sendPayoutPaidEmail, sendPayoutRejectedEmail } from "./_lib/email";

const MIN_PAYOUT_CENTS = 2500; // $25
const MIN_XRGE_PAYOUT_CENTS = 100; // $1 min for instant XRGE
const MIN_STRIPE_PAYOUT_CENTS = 500; // $5 min for instant Stripe Connect transfer

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { allowed } = await checkRateLimit(auth.userId, "payouts", { max: 30, windowSeconds: 60 });
    if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

    const sql = getDb();

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS payout_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount_cents INT NOT NULL,
        method TEXT NOT NULL DEFAULT 'paypal',
        payout_details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ
      )
    `.catch(() => {});
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cash_balance_cents INT NOT NULL DEFAULT 0`.catch(() => {});

    // GET — get own balance + payout history (or admin: all pending)
    if (req.method === "GET") {
      const isAdmin = auth.email === ADMIN_EMAIL;
      const adminView = req.query.admin === "1" && isAdmin;

      if (adminView) {
        const rows = await sql`
          SELECT pr.*, u.email, COALESCE(p.username, LEFT(u.email, 3) || '***') AS username
          FROM payout_requests pr
          JOIN users u ON u.id = pr.user_id
          LEFT JOIN profiles p ON p.user_id = pr.user_id
          ORDER BY
            CASE WHEN pr.status = 'pending' THEN 0 ELSE 1 END,
            pr.created_at DESC
          LIMIT 100
        `;
        return res.json({ requests: rows });
      }

      const [user] = await sql`SELECT cash_balance_cents FROM users WHERE id = ${auth.userId}::uuid`;
      const requests = await sql`
        SELECT id, amount_cents, method, payout_details, status, admin_note, created_at, reviewed_at, paid_at
        FROM payout_requests
        WHERE user_id = ${auth.userId}::uuid
        ORDER BY created_at DESC
        LIMIT 20
      `;
      return res.json({
        cashBalanceCents: user?.cash_balance_cents || 0,
        minPayoutCents: MIN_PAYOUT_CENTS,
        requests,
      });
    }

    // POST — request a payout
    if (req.method === "POST") {
      // Verification gate: NEW payouts require an active verified status.
      // Existing cash_balance accrued before verification is grandfathered:
      // they CAN still see it, they just can't withdraw without verification.
      if (!(await isVerified(sql, auth.userId))) {
        return res.status(403).json({ error: VERIFICATION_REQUIRED_MESSAGE, code: "VERIFICATION_REQUIRED" });
      }

      const { amountCents, method, payoutDetails } = req.body || {};
      const amount = parseInt(amountCents) || 0;
      const isXrge = method === "xrge";
      const isStripe = method === "stripe";
      const minAmount = isXrge ? MIN_XRGE_PAYOUT_CENTS : isStripe ? MIN_STRIPE_PAYOUT_CENTS : MIN_PAYOUT_CENTS;

      if (amount < minAmount) {
        return res.status(400).json({ error: `Minimum payout is $${(minAmount / 100).toFixed(2)}` });
      }
      if (!method) {
        return res.status(400).json({ error: "Payment method is required" });
      }
      if (!["paypal", "bank", "crypto", "xrge", "stripe"].includes(method)) {
        return res.status(400).json({ error: "Invalid payout method" });
      }
      // paypal/bank/crypto need free-text details; xrge & stripe are automated.
      if (!isXrge && !isStripe && !payoutDetails?.trim()) {
        return res.status(400).json({ error: "Payment details are required" });
      }

      // Check balance
      const [user] = await sql`SELECT cash_balance_cents, xrge_bank_balance, stripe_connect_account_id FROM users WHERE id = ${auth.userId}::uuid`;
      if (!user || (user.cash_balance_cents || 0) < amount) {
        return res.status(402).json({ error: "Insufficient cash balance" });
      }

      // Stripe Connect instant payout — transfer from platform balance to the
      // creator's connected (Express) account; Stripe then pays to their bank.
      if (isStripe) {
        const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
        if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });
        const acctId = user.stripe_connect_account_id;
        if (!acctId) {
          return res.status(400).json({ error: "Set up Stripe payouts first.", code: "CONNECT_REQUIRED" });
        }
        const stripe = new Stripe(STRIPE_SECRET_KEY);

        // Confirm the connected account can actually receive payouts.
        try {
          const acct = await stripe.accounts.retrieve(acctId);
          if (!acct.payouts_enabled) {
            return res.status(400).json({ error: "Finish your Stripe onboarding before withdrawing.", code: "CONNECT_INCOMPLETE" });
          }
        } catch (e: any) {
          return res.status(502).json({ error: e?.message || "Could not verify Stripe account" });
        }

        // Deduct first (atomic, race-safe), then transfer; refund on failure.
        const [deducted] = await sql`
          UPDATE users SET cash_balance_cents = cash_balance_cents - ${amount}, updated_at = now()
          WHERE id = ${auth.userId}::uuid AND cash_balance_cents >= ${amount}
          RETURNING id
        `;
        if (!deducted) return res.status(402).json({ error: "Insufficient cash balance" });

        try {
          const transfer = await stripe.transfers.create({
            amount,
            currency: "usd",
            destination: acctId,
            metadata: { userId: auth.userId, kind: "creator_payout" },
          });
          const [row] = await sql`
            INSERT INTO payout_requests (user_id, amount_cents, method, payout_details, status, reviewed_at, paid_at)
            VALUES (${auth.userId}::uuid, ${amount}, 'stripe', ${"Stripe transfer " + transfer.id}, 'paid', now(), now())
            RETURNING id
          `;
          return res.status(200).json({ id: row.id, instant: true, method: "stripe", transferId: transfer.id, amountCents: amount });
        } catch (e: any) {
          // Refund the deduction — transfer never went through.
          await sql`UPDATE users SET cash_balance_cents = cash_balance_cents + ${amount}, updated_at = now() WHERE id = ${auth.userId}::uuid`;
          console.error("[payouts] stripe transfer failed:", e?.message);
          return res.status(502).json({ error: e?.message || "Stripe transfer failed — balance refunded." });
        }
      }

      // XRGE instant payout — convert cash to XRGE bank balance immediately
      if (isXrge) {
        const xrgeRate = await fetchXrgePrice();
        if (!xrgeRate || xrgeRate <= 0) {
          return res.status(503).json({ error: "Unable to fetch XRGE price. Try again later." });
        }
        const usdAmount = amount / 100;
        const xrgeAmount = usdAmount / xrgeRate;

        // Deduct cash, credit XRGE bank, log transaction — all atomic
        const [result] = await sql`
          WITH deduct AS (
            UPDATE users
            SET cash_balance_cents = cash_balance_cents - ${amount},
                xrge_bank_balance = COALESCE(xrge_bank_balance, 0) + ${xrgeAmount}::numeric,
                updated_at = now()
            WHERE id = ${auth.userId}::uuid AND cash_balance_cents >= ${amount}
            RETURNING id, xrge_bank_balance
          ), txn AS (
            INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, metadata)
            SELECT id, 'payout_conversion', ${xrgeAmount}::numeric, xrge_bank_balance,
                   ${JSON.stringify({ fromCashCents: amount, xrgeRate })}::jsonb
            FROM deduct
            RETURNING user_id
          ), payout AS (
            INSERT INTO payout_requests (user_id, amount_cents, method, payout_details, status, reviewed_at, paid_at)
            SELECT id, ${amount}, 'xrge', ${'Instant XRGE conversion: ' + xrgeAmount.toFixed(4) + ' XRGE'}, 'paid', now(), now()
            FROM deduct
            RETURNING id
          )
          SELECT
            (SELECT xrge_bank_balance FROM deduct) AS new_xrge_balance,
            (SELECT id FROM payout) AS payout_id,
            EXISTS(SELECT 1 FROM deduct) AS success
        `;

        if (!result?.success) {
          return res.status(402).json({ error: "Insufficient cash balance (race condition)" });
        }

        return res.status(200).json({
          id: result.payout_id,
          instant: true,
          method: "xrge",
          cashDeducted: amount,
          xrgeAmount: parseFloat(xrgeAmount.toFixed(4)),
          xrgeRate,
          newXrgeBalance: parseFloat(result.new_xrge_balance),
        });
      }

      // Non-XRGE: check no pending request
      const [pending] = await sql`
        SELECT id FROM payout_requests WHERE user_id = ${auth.userId}::uuid AND status = 'pending' LIMIT 1
      `;
      if (pending) {
        return res.status(409).json({ error: "You already have a pending payout request" });
      }

      // Deduct balance and create request
      await sql`
        UPDATE users SET cash_balance_cents = cash_balance_cents - ${amount}, updated_at = now()
        WHERE id = ${auth.userId}::uuid
      `;
      const [row] = await sql`
        INSERT INTO payout_requests (user_id, amount_cents, method, payout_details)
        VALUES (${auth.userId}::uuid, ${amount}, ${method}, ${payoutDetails})
        RETURNING id, created_at
      `;

      // Alert admin so the manual payout doesn't sit unnoticed (best-effort).
      try {
        const [prof] = await sql`
          SELECT COALESCE(p.username, LEFT(u.email, 3) || '***') AS username
          FROM users u LEFT JOIN profiles p ON p.user_id = u.id
          WHERE u.id = ${auth.userId}::uuid
        `;
        await sendPayoutRequestedAdminEmail(ADMIN_EMAIL, {
          username: prof?.username || "creator",
          amountCents: amount,
          method,
          payoutDetails: payoutDetails || "",
          requestId: row.id,
        });
      } catch (e: any) {
        console.error("[payouts] admin alert failed:", e?.message);
      }

      return res.status(201).json({ id: row.id, createdAt: row.created_at });
    }

    // PATCH — admin approve/reject/mark paid
    if (req.method === "PATCH") {
      if (auth.email !== ADMIN_EMAIL) {
        return res.status(403).json({ error: "Admin only" });
      }

      const { requestId, action, adminNote } = req.body || {};
      if (!requestId || !["approve", "reject", "paid"].includes(action)) {
        return res.status(400).json({ error: "requestId and action (approve/reject/paid) required" });
      }

      const [pr] = await sql`SELECT * FROM payout_requests WHERE id = ${requestId}::uuid`;
      if (!pr) return res.status(404).json({ error: "Request not found" });

      const [creator] = await sql`SELECT email FROM users WHERE id = ${pr.user_id}::uuid`;

      if (action === "reject") {
        // Refund balance
        await sql`
          UPDATE users SET cash_balance_cents = cash_balance_cents + ${pr.amount_cents}, updated_at = now()
          WHERE id = ${pr.user_id}::uuid
        `;
        await sql`
          UPDATE payout_requests SET status = 'rejected', admin_note = ${adminNote || null}, reviewed_at = now()
          WHERE id = ${requestId}::uuid
        `;
        if (creator?.email) {
          sendPayoutRejectedEmail(creator.email, { amountCents: pr.amount_cents, note: adminNote }).catch((e) =>
            console.error("[payouts] reject email:", e?.message),
          );
        }
      } else if (action === "approve") {
        await sql`
          UPDATE payout_requests SET status = 'approved', admin_note = ${adminNote || null}, reviewed_at = now()
          WHERE id = ${requestId}::uuid
        `;
      } else if (action === "paid") {
        await sql`
          UPDATE payout_requests SET status = 'paid', paid_at = now()
          WHERE id = ${requestId}::uuid
        `;
        if (creator?.email) {
          sendPayoutPaidEmail(creator.email, { amountCents: pr.amount_cents, method: pr.method }).catch((e) =>
            console.error("[payouts] paid email:", e?.message),
          );
        }
      }

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[payouts]", err.message);
    return res.status(500).json({ error: "Failed to process payout request" });
  }
}
