/**
 * First real Krea 2 render.
 *
 * Two things are unproven until this runs. The worker's ComfyUI is pinned at
 * whenever its image was built, and Krea 2 support (CLIPLoader type "krea2",
 * the SingleStreamDiT model class) has to be present in that build — a submit
 * naming an unknown type fails rather than degrading. And the graph itself is
 * transcribed from Comfy-Org's template, so it needs a render to confirm the
 * transcription.
 *
 *   node --env-file=.env --import tsx scripts/krea2-check.mts [W] [H]
 *
 * 3 credits.
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const W = Number(process.argv[2]) || 1024;
const H = Number(process.argv[3]) || 1024;

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
console.log(`${owner.email}, ${owner.credits} credits · krea2 ${W}x${H}\n`);

const post = (body: any) =>
  fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) })) as Promise<any>;

const t0 = Date.now();
const sub = await post({
  action: "generate", workflow: "krea2",
  prompt: "a lone figure on a rain-slick city street at night, neon signage, "
    + "shot on 35mm film, shallow depth of field, cinematic",
  width: W, height: H, steps: 8, cfg: 1,
});
if (!sub.promptId) {
  console.error(`submit failed: ${JSON.stringify(sub).slice(0, 400)}`);
  console.error(`\nIf this names an unknown node or CLIP type, the worker's ComfyUI`);
  console.error(`predates Krea 2 support and Dockerfile.zimage needs rebuilding.`);
  process.exit(1);
}
process.stdout.write(`${sub.promptId} `);

let out: any = null;
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  // Submit's endpoint must be echoed back or the status lookup 404s.
  const p = await post({
    action: "poll", promptId: sub.promptId, outputType: "image",
    runpodEndpointId: sub.runpodEndpointId,
  });
  if (p.error) { console.error(`\nfailed: ${String(p.error).slice(0, 400)}`); process.exit(1); }
  if (p.status === "done" || p.image) { out = p; break; }
  process.stdout.write(".");
}
console.log();

const url = out?.image || out?.previewUrl;
if (!url) { console.error("timed out with no output"); process.exit(1); }

const file = `/tmp/gltch-work/krea2-${W}x${H}.png`;
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
writeFileSync(file, buf);
const dims = execFileSync("ffprobe", [
  "-v", "error", "-select_streams", "v:0",
  "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file,
]).toString().trim();

console.log(`rendered in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`  ${file}  ${dims}  ${Math.round(buf.length / 1024)} KB`);
console.log(dims === `${W}x${H}` ? "\nKREA 2 WORKS." : `\nunexpected size ${dims}`);
process.exit(dims === `${W}x${H}` ? 0 : 1);
