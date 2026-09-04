/**
 * Confirm the LTX spatial upscale tail works on the live worker.
 *
 * Two things are unproven until a render happens: that the worker's ComfyUI
 * core actually carries LTXVLatentUpsampler (added upstream 2026-01-04), and
 * that upsampling the latent really doubles the decoded frame rather than
 * being silently dropped. A submit that 400s on an unknown node, or a video
 * that comes back at 1x, both mean LTX_SPATIAL_UPSCALER should go back to "".
 *
 *   node --env-file=.env --import tsx scripts/ltx-upscale-check.mts [W] [H]
 *
 * Costs ~14 credits (shortest preset).
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const W = Number(process.argv[2]) || 480;
const H = Number(process.argv[3]) || 832;

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });

const post = (body: any) =>
  fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) as any }));

console.log(`acting as ${owner.email}, ${owner.credits} credits`);
console.log(`requesting ${W}x${H} — expecting ${W * 2}x${H * 2} out if the x2 tail runs\n`);

const t0 = Date.now();
const sub = await post({
  action: "generate", workflow: "ltx-video",
  prompt: "a woman in a red jacket walks toward camera down a rain-slick neon alley, sharp facial detail",
  width: W, height: H, frameCount: 49, frameRate: 24, ltxAudio: false,
});
if (!sub.body.promptId) {
  console.error(`submit failed: HTTP ${sub.status}`, JSON.stringify(sub.body).slice(0, 400));
  console.error("\nIf this names an unknown node, set LTX_SPATIAL_UPSCALER=\"\" and restart.");
  process.exit(1);
}
process.stdout.write(`${sub.body.promptId} `);

let out: any = null;
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  // The submit response carries the endpoint it used; poll must echo it back
  // or the status lookup 404s against the wrong endpoint.
  const p = await post({
    action: "poll", promptId: sub.body.promptId, outputType: "video",
    runpodEndpointId: sub.body.runpodEndpointId,
  });
  if (p.body.error) { console.error(`\njob failed: ${p.body.error}`); process.exit(1); }
  if (p.body.status === "done" || p.body.video || p.body.image) { out = p.body; break; }
  process.stdout.write(".");
}
console.log();

const url = out?.video || out?.image;
if (!url) { console.error("timed out with no output"); process.exit(1); }

const secs = Math.round((Date.now() - t0) / 1000);
const file = `/tmp/gltch-work/ltx-upscaled-${W}x${H}.mp4`;
writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
const got = execFileSync("ffprobe", [
  "-v", "error", "-select_streams", "v:0",
  "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file,
]).toString().trim();

console.log(`done in ${secs}s — saved ${file}`);
console.log(`\nrequested ${W}x${H}  ->  returned ${got}`);
if (got === `${W * 2}x${H * 2}`) console.log("x2 TAIL ACTIVE — latent upsampler ran.");
else if (got === `${W}x${H}`) console.log("NOT UPSCALED — the node was skipped; check LTX_SPATIAL_UPSCALER.");
else console.log("UNEXPECTED SIZE — inspect before trusting this.");
process.exit(got === `${W * 2}x${H * 2}` ? 0 : 1);
