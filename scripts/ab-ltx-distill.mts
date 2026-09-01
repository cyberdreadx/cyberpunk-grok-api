/**
 * A/B the LTX distill LoRA, one variable at a time.
 *
 * api/comfyui.ts warns that the base-trained distill LoRA "may soften output"
 * when LTX_UNET points at a full fine-tune — which is exactly the production
 * config (10Eros_v1-Q4_K_M.gguf with the LoRA still on at 0.6). This runs the
 * same prompt at the same seed, once per setting, so the only difference is
 * the LoRA.
 *
 *   node --env-file=.env --import tsx scripts/ab-ltx-distill.mts <label>
 *
 * Run it once before flipping LTX_DISTILL_LORA and once after. Each run costs
 * one LTX generation (~28 credits at the default 4s clip).
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const LABEL = process.argv[2] || "run";
const FRAMES = Number(process.argv[3]) || 97;
const OUT = "/tmp/gltch-work";

// Fixed so both runs are the same generation apart from the LoRA.
const SEED = 424242;
const PROMPT =
  "a woman in a red jacket walks toward camera down a rain-slick neon alley, "
  + "steam rising, sharp facial detail, cinematic lighting, shallow depth of field";

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
console.log(`${LABEL}: acting as ${owner.email}, ${owner.credits} credits`);
console.log(`seed ${SEED}, ${FRAMES} frames (~${(FRAMES / 24).toFixed(1)}s at 24fps)\n`);

const t0 = Date.now();
const res = await fetch(`${BASE}/api/comfyui`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    action: "generate",
    workflow: "ltx-video",
    prompt: PROMPT,
    seed: SEED,
    width: 768,
    height: 512,
    frameCount: FRAMES,
    frameRate: 24,
    ltxAudio: false,      // audio is unused in production; keep the test to video
  }),
  signal: AbortSignal.timeout(120000),
});
const data = (await res.json().catch(() => ({}))) as any;
if (!data.promptId) {
  console.error(`submit failed: HTTP ${res.status}`, JSON.stringify(data).slice(0, 300));
  process.exit(1);
}
console.log(`submitted ${data.promptId} on endpoint ${data.runpodEndpointId}`);

let out: any = null;
const deadline = Date.now() + 290000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  const p = await fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    // The submit response carries the endpoint it actually used; poll must
    // echo it back or the status lookup 404s against the wrong endpoint.
    body: JSON.stringify({
      action: "poll", promptId: data.promptId, outputType: "video",
      runpodEndpointId: data.runpodEndpointId,
    }),
    signal: AbortSignal.timeout(60000),
  }).then((r) => r.json()).catch(() => ({})) as any;
  if (p.status === "done" || p.video || p.error) { out = p; break; }
  process.stdout.write(".");
}
console.log();

const url = out?.video || out?.image;
if (!url) {
  console.error(`no output: ${JSON.stringify(out).slice(0, 300)}`);
  process.exit(1);
}

const secs = Math.round((Date.now() - t0) / 1000);
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
const file = `${OUT}/ltx-${LABEL}.mp4`;
writeFileSync(file, buf);

console.log(`done in ${secs}s`);
console.log(`  ${url}`);
console.log(`  saved ${file}  (${Math.round(buf.length / 1024)} KB)`);
writeFileSync(`${OUT}/ltx-${LABEL}.url`, url);
process.exit(0);
