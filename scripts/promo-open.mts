/**
 * Open the promo up: self-serve instead of hand-issued codes, and a cap that
 * isn't 20.
 *
 * Goes through the admin endpoint rather than writing app_config directly, so
 * the values pass the same clamps the UI does and the change is logged with an
 * actor. Verifies the public endpoint afterwards, because the thing that
 * matters is what a claimant sees, not what the row says.
 *
 *   node --env-file=.env --import tsx scripts/promo-open.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const ADMIN = process.env.ADMIN_EMAIL;
if (!ADMIN) { console.error("ADMIN_EMAIL not set"); process.exit(1); }

const [admin] = await sql`SELECT id, email FROM users WHERE email = ${ADMIN} LIMIT 1` as any[];
if (!admin) { console.error(`no user for ADMIN_EMAIL ${ADMIN}`); process.exit(1); }
const token = signToken({ userId: admin.id, email: admin.email });

const call = async (path: string, init: any = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
};

const before = await call("/api/admin/promo?status=pending");
console.log("before:", JSON.stringify(before.body.config));

// requireCode is the actual bottleneck — codes only move when Brandon hands
// them out by hand, which is why 20 were minted and 0 were used. The age and
// render minimums stay exactly as they are: with codes gone they are the only
// thing standing between the promo and throwaway accounts.
const patch = {
  enabled: true,
  requireCode: false,
  maxApproved: 150,
};

const saved = await call("/api/admin/promo", {
  method: "POST",
  body: { action: "save-config", config: patch },
});
console.log("after :", JSON.stringify(saved.body.config));

// What a logged-in claimant actually sees.
const [someone] = await sql`
  SELECT u.id, u.email FROM users u
  WHERE u.created_at < now() - interval '7 days'
    AND (SELECT count(*) FROM usage_log l WHERE l.user_id = u.id AND l.credits_used > 0
         AND l.mode NOT LIKE '%refunded%' AND l.mode LIKE 'comfy-%') >= 3
  ORDER BY u.created_at DESC LIMIT 1` as any[];

if (someone) {
  const userTok = signToken({ userId: someone.id, email: someone.email });
  const pub = await fetch(`${BASE}/api/promo-claim`, {
    headers: { Authorization: `Bearer ${userTok}` },
  }).then((r) => r.json()) as any;
  console.log(`\npublic view (as an eligible user):`);
  console.log(`  open=${pub.open}  slots=${pub.slotsRemaining}/${pub.maxApproved}` +
              `  credits=${pub.creditAmount}  requireCode=${pub.requireCode}`);
  console.log(`  eligible=${pub.eligible}  hosts=${(pub.allowedHosts || []).join(", ")}`);
  if (pub.requireCode) console.log("  !! still asking for a code");
  if (!pub.open) console.log("  !! still closed");
}
process.exit(0);
