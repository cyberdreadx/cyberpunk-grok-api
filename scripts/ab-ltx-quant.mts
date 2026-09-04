/**
 * Q4_K_M vs Q8_0 on LTX, one variable at a time.
 *
 * The x2 spatial tail turned out to add resolution without much detail — a
 * 960x1664 file carrying roughly 480x832 of real information — which means the
 * softness lives in the sampler's output, not the upscale. Quantisation is the
 * remaining suspect: LTX runs Q4_K_M while WAN runs a Q8 pair.
 *
 * Same seed, same prompt, tail on for both, so the ONLY difference is
 * LTX_UNET. Framed as a close-up on purpose: a full-body shot spends its
 * pixels on the alley and leaves ~60px of face, which is what made the last
 * comparison unreadable.
 *
 *   node --env-file=.env --import tsx scripts/ab-ltx-quant.mts <label>
 *
 * Run once per quantisation, flipping LTX_UNET and restarting between.
 * ~14 credits per run.
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const LABEL = process.argv[2] || "run";
const OUT = "/tmp/gltch-work";

// Fixed so the two runs differ only by the model file.
const SEED = 777777;
const PROMPT =
  "extreme close-up portrait of a woman's face, red leather jacket collar, "
  + "neon-lit alley at night, sharp skin texture, visible pores, catchlights in "
  + "the eyes, shallow depth of field, cinematic film still";

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
console.log(`[${LABEL}] ${owner.email}, ${owner.credits} credits · seed ${SEED}`);

const post = (body: any) =>
  fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).then((r) => r.json()).catch(() => ({})) as Promise<any>;

const t0 = Date.now();
const sub = await post({
  action: "generate", workflow: "ltx-video",
  prompt: PROMPT, seed: SEED,
  width: 480, height: 832,
  frameCount: 49, frameRate: 24, ltxAudio: false,
});
if (!sub.promptId) {
  console.error(`submit failed: ${JSON.stringify(sub).slice(0, 300)}`);
  process.exit(1);
}
process.stdout.write(`  ${sub.promptId} `);

let out: any = null;
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  // Submit's endpoint must be echoed back or the status lookup 404s.
  const p = await post({
    action: "poll", promptId: sub.promptId, outputType: "video",
    runpodEndpointId: sub.runpodEndpointId,
  });
  if (p.error) { console.error(`\nfailed: ${p.error}`); process.exit(1); }
  if (p.status === "done" || p.video || p.image) { out = p; break; }
  process.stdout.write(".");
}
console.log();

const url = out?.video || out?.image;
if (!url) { console.error("no output"); process.exit(1); }

const file = `${OUT}/quant-${LABEL}.mp4`;
writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
const dims = execFileSync("ffprobe", [
  "-v", "error", "-select_streams", "v:0",
  "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file,
]).toString().trim();

// Native-resolution crop, never scaled — scaling a frame down fakes sharpness,
// which is exactly how the previous comparison misled.
const frame = `${OUT}/quant-${LABEL}-frame.png`;
execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "select=eq(n\\,24)", "-frames:v", "1", "-y", frame]);
const crop = `${OUT}/quant-${LABEL}-crop.png`;
execFileSync("ffmpeg", ["-v", "error", "-i", frame, "-vf", "crop=480:480:240:300", "-y", crop]);

console.log(`  ${Math.round((Date.now() - t0) / 1000)}s · ${dims} · ${Math.round(Buffer.from(await (await fetch(url)).arrayBuffer()).length / 1024)} KB`);
console.log(`  ${file}`);
console.log(`  ${crop}  <- native-res 480x480 crop`);
process.exit(0);
