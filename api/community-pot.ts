/**
 * Community Credit Pot — global shared pool.
 *
 * GET    /api/community-pot                       → status (balance, top donors, today's eligibility)
 * POST   /api/community-pot { action: "claim" }   → claim today's ration (1 per user / UTC day)
 * POST   /api/community-pot { action: "donate", amount } → donate from own pack_credits to pot
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { getUserFromRequest, checkBan } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

// Tunables
const DAILY_RATION = 10;       // credits granted per claim if pot has it
const MIN_DONATION = 1;
const MAX_DONATION = 5000;
const TOP_DONORS_LIMIT = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();

  // Rate limit lightly
  const { allowed } = await checkRateLimit(auth.userId, "community-pot", { max: 30, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Slow down" });

  try {
    if (req.method === "GET") {
      const [pot] = await sql`SELECT balance, total_donated, total_claimed FROM community_pot WHERE id = 1`;
      const balance = pot?.balance ?? 0;

      const claimedToday = await sql`
        SELECT amount FROM pot_claims
        WHERE user_id = ${auth.userId}::uuid
          AND claim_date = (now() AT TIME ZONE 'UTC')::date
        LIMIT 1
      `;

      // Email-verified gate (any confirmed account, not the paid Verification subscription)
      const [u] = await sql`
        SELECT email_verified, sub_credits, pack_credits, created_at
        FROM users WHERE id = ${auth.userId}
      `;
      const isEmailVerified = !!u?.email_verified;
      const accountAgeMs = u?.created_at ? Date.now() - new Date(u.created_at).getTime() : 0;
      const ageOk = accountAgeMs >= 24 * 60 * 60 * 1000;

      const claimAmount = Math.min(DAILY_RATION, balance);
      const eligible =
        isEmailVerified &&
        ageOk &&
        balance > 0 &&
        claimedToday.length === 0;

      let reason: string | null = null;
      if (!isEmailVerified) reason = "Confirm your email to claim from the pot.";
      else if (!ageOk) reason = "Account must be at least 24 hours old.";
      else if (balance <= 0) reason = "Pot is empty — donate to refill it!";
      else if (claimedToday.length > 0) reason = "Already claimed today. Comes back tomorrow (UTC midnight).";

      // Top donors all-time
      const top = await sql`
        SELECT d.user_id, COALESCE(p.username, '') AS username, SUM(d.amount)::int AS total
        FROM pot_donations d
        LEFT JOIN profiles p ON p.user_id = d.user_id
        GROUP BY d.user_id, p.username
        ORDER BY total DESC
        LIMIT ${TOP_DONORS_LIMIT}
      `;

      // Today's donors (last 24h)
      const todayDonors = await sql`
        SELECT COALESCE(p.username, '') AS username, SUM(d.amount)::int AS total
        FROM pot_donations d
        LEFT JOIN profiles p ON p.user_id = d.user_id
        WHERE d.created_at > now() - interval '24 hours'
        GROUP BY p.username
        ORDER BY total DESC
        LIMIT ${TOP_DONORS_LIMIT}
      `;

      return res.status(200).json({
        balance,
        totalDonated: Number(pot?.total_donated || 0),
        totalClaimed: Number(pot?.total_claimed || 0),
        dailyRation: DAILY_RATION,
        claim: {
          amount: claimAmount,
          claimedToday: claimedToday.length > 0,
          eligible,
          reason,
        },
        topDonors: top.map((r: any) => ({ username: r.username || "anon", total: Number(r.total) })),
        todayDonors: todayDonors.map((r: any) => ({ username: r.username || "anon", total: Number(r.total) })),
        userBalance: { sub: u?.sub_credits || 0, pack: u?.pack_credits || 0 },
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const ban = await checkBan(sql, auth.userId);
    if (ban.banned) return res.status(403).json({ error: "Account suspended" });

    const action = String((req.body || {}).action || "");

    // ── CLAIM ──
    if (action === "claim") {
      const [u] = await sql`
        SELECT email_verified, created_at
        FROM users WHERE id = ${auth.userId}
      `;
      if (!u?.email_verified) return res.status(403).json({ error: "Confirm your email first." });
      const ageMs = u?.created_at ? Date.now() - new Date(u.created_at).getTime() : 0;
      if (ageMs < 24 * 60 * 60 * 1000) return res.status(403).json({ error: "Account too new (24h minimum)." });

      // Atomic-ish: deduct from pot only if balance > 0 and user hasn't claimed.
      // We use a CTE to (a) check uniqueness (b) decrement (c) insert claim row.
      const [pot] = await sql`SELECT balance FROM community_pot WHERE id = 1`;
      const balance = pot?.balance ?? 0;
      if (balance <= 0) return res.status(400).json({ error: "Pot is empty." });
      const grant = Math.min(DAILY_RATION, balance);

      // Insert claim first (unique constraint blocks double-claim same day)
      try {
        await sql`
          INSERT INTO pot_claims (user_id, amount)
          VALUES (${auth.userId}::uuid, ${grant})
        `;
      } catch (e: any) {
        if (String(e?.message || e).includes("pot_claims_user_id_claim_date_key") ||
            String(e?.code) === "23505") {
          return res.status(400).json({ error: "Already claimed today." });
        }
        throw e;
      }

      // Decrement pot atomically (clamped)
      const [updated] = await sql`
        UPDATE community_pot
        SET balance = GREATEST(0, balance - ${grant}),
            total_claimed = total_claimed + ${grant},
            updated_at = now()
        WHERE id = 1
        RETURNING balance
      `;

      // Grant credits to user (pack_credits — same as bulk grant)
      await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${grant})`;

      // Log to transactions if table exists (best-effort)
      try {
        await sql`
          INSERT INTO transactions (user_id, type, amount, description, created_at)
          VALUES (${auth.userId}::uuid, 'pot_claim', ${grant}, 'Community pot daily claim', now())
        `;
      } catch { /* table may not exist */ }

      return res.status(200).json({ ok: true, granted: grant, potBalance: updated.balance });
    }

    // ── DONATE ──
    if (action === "donate") {
      const amount = Math.floor(Number((req.body || {}).amount));
      if (!Number.isFinite(amount) || amount < MIN_DONATION || amount > MAX_DONATION) {
        return res.status(400).json({ error: `Donate between ${MIN_DONATION} and ${MAX_DONATION} credits.` });
      }

      // Subtract from pack first, then sub. Fail if not enough total.
      const [u] = await sql`SELECT sub_credits, pack_credits FROM users WHERE id = ${auth.userId} FOR UPDATE`;
      const sub = u?.sub_credits || 0;
      const pack = u?.pack_credits || 0;
      if (sub + pack < amount) return res.status(400).json({ error: "Not enough credits to donate." });

      const fromPack = Math.min(pack, amount);
      const fromSub = amount - fromPack;
      await sql`
        UPDATE users
        SET pack_credits = pack_credits - ${fromPack},
            sub_credits = sub_credits - ${fromSub},
            updated_at = now()
        WHERE id = ${auth.userId}
      `;

      // Add to pot + log donation
      const [updated] = await sql`
        UPDATE community_pot
        SET balance = balance + ${amount},
            total_donated = total_donated + ${amount},
            updated_at = now()
        WHERE id = 1
        RETURNING balance
      `;
      await sql`
        INSERT INTO pot_donations (user_id, amount)
        VALUES (${auth.userId}::uuid, ${amount})
      `;

      try {
        await sql`
          INSERT INTO transactions (user_id, type, amount, description, created_at)
          VALUES (${auth.userId}::uuid, 'pot_donation', ${-amount}, 'Donated to community pot', now())
        `;
      } catch { /* best effort */ }

      return res.status(200).json({ ok: true, donated: amount, potBalance: updated.balance });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err: any) {
    console.error("[community-pot]", err?.message, err?.stack);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
