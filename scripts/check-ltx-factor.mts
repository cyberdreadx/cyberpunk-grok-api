/**
 * Confirm the models endpoint reports the LTX upscale factor the UI labels with.
 *
 *   node --env-file=.env --import tsx scripts/check-ltx-factor.mts
 */
process.env.RESEND_API_KEY = "";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const [owner] = await sql`SELECT id, email FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });

const r = await fetch("https://api.gltch.app/api/comfyui", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ action: "models" }),
  signal: AbortSignal.timeout(30000),
});
const d = await r.json() as any;
console.log(`HTTP ${r.status}`);
console.log(`ltxUpscaleFactor: ${d.ltxUpscaleFactor}`);
console.log(d.ltxUpscaleFactor === 2
  ? "correct — UI will label 480x832 as 960x1664"
  : "unexpected — UI would label the un-upscaled size");
process.exit(d.ltxUpscaleFactor === 2 ? 0 : 1);
