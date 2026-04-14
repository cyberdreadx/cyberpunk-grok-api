import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";
import { fetchXrgePrice } from "./_lib/xrge";

const MIN_PAYOUT_CENTS = 2500; // $25
const MIN_XRGE_PAYOUT_CENTS = 100; // $1 min for instant XRGE

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
      const { amountCents, method, payoutDetails } = req.body || {};
      const amount = parseInt(amountCents) || 0;
      const isXrge = method === "xrge";
      const minAmount = isXrge ? MIN_XRGE_PAYOUT_CENTS : MIN_PAYOUT_CENTS;

      if (amount < minAmount) {
        return res.status(400).json({ error: `Minimum payout is $${(minAmount / 100).toFixed(2)}` });
      }
      if (!method) {
        return res.status(400).json({ error: "Payment method is required" });
      }
      if (!["paypal", "bank", "crypto", "xrge"].includes(method)) {
        return res.status(400).json({ error: "Invalid payout method" });
      }
      if (!isXrge && !payoutDetails?.trim()) {
        return res.status(400).json({ error: "Payment details are required" });
      }

      // Check balance
      const [user] = await sql`SELECT cash_balance_cents, xrge_bank_balance FROM users WHERE id = ${auth.userId}::uuid`;
      if (!user || (user.cash_balance_cents || 0) < amount) {
        return res.status(402).json({ error: "Insufficient cash balance" });
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
      }

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[payouts]", err.message);
    return res.status(500).json({ error: "Failed to process payout request" });
  }
}
