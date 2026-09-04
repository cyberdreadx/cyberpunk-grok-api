/**
 * Current state of the anti-farm promo: config, codes, claims.
 *
 *   node --env-file=.env --import tsx scripts/promo-status.mts
 */
process.env.RESEND_API_KEY = "";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { getPromoConfig } from "/home/neon/cyberpunk-grok-api/api/_lib/promo.ts";

const sql = getDb();
const cfg = await getPromoConfig();
console.log("config (app_config.antifarm_promo, falls back to defaults):");
for (const [k, v] of Object.entries(cfg)) console.log(`  ${k}: ${v}`);

const [codes] = await sql`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE used_by IS NULL)::int AS unused,
         count(*) FILTER (WHERE code IS NOT NULL)::int AS readable
  FROM promo_codes` as any[];
console.log(`\ncodes: ${codes.total} total · ${codes.unused} unused · ${codes.readable} readable in admin`);

const claims = await sql`
  SELECT status, count(*)::int AS n FROM promo_claims GROUP BY status` as any[];
console.log(`claims: ${claims.length ? claims.map((r: any) => `${r.status} ${r.n}`).join(" · ") : "none yet"}`);
process.exit(0);
