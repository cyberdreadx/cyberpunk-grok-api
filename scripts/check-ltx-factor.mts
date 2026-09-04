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
// 1 is the production value: the x2 tail degraded output and was turned off in
// favour of rendering the target size natively. A 2 here means the tail is on
// and the LTX presets would be asking for 3328x1920.
const f = d.ltxUpscaleFactor;
console.log(f === 1
  ? "tail off — the size picker labels the native render, as intended"
  : `tail ON at x${f} — check this is deliberate; LTX presets are already native size`);
process.exit(typeof f === "number" && f >= 1 ? 0 : 1);
