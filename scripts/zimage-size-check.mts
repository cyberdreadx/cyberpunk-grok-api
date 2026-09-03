/**
 * Prove the new Z-Image OUTPUT SIZE presets actually reach the model.
 *
 * The picker is only worth adding if the workflow honours a non-1024 pair —
 * zimage was hardcoded to 1024x1024, so nothing has ever exercised the other
 * buckets. Submits one portrait render and reports the pixel dimensions of the
 * image that comes back, which is the only evidence that matters.
 *
 *   node --env-file=.env --import tsx scripts/zimage-size-check.mts [W] [H]
 *
 * Costs 3 credits (zimage is flat-priced regardless of size).
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const W = Number(process.argv[2]) || 768;
const H = Number(process.argv[3]) || 1344;

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
console.log(`acting as ${owner.email}, ${owner.credits} credits`);
console.log(`requesting ${W}x${H} (ratio ${(W / H).toFixed(3)})\n`);

const submit = await fetch(`${BASE}/api/comfyui`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    action: "generate",
    workflow: "zimage",
    prompt: "a lone figure standing at the end of a neon-lit corridor, full body, cinematic",
    width: W,
    height: H,
    steps: 8,
    cfg: 1,
  }),
  signal: AbortSignal.timeout(120000),
});
const data = (await submit.json().catch(() => ({}))) as any;
if (!data.promptId) {
  console.error(`submit failed: HTTP ${submit.status}`, JSON.stringify(data).slice(0, 300));
  process.exit(1);
}
console.log(`submitted ${data.promptId} on endpoint ${data.runpodEndpointId}`);

let out: any = null;
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  // The submit response carries the endpoint it actually used; poll must echo
  // it back or the status lookup 404s against the wrong endpoint.
  const p = await fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: "poll", promptId: data.promptId, outputType: "image",
      runpodEndpointId: data.runpodEndpointId,
    }),
    signal: AbortSignal.timeout(60000),
  }).then((r) => r.json()).catch(() => ({})) as any;
  if (p.status === "done" || p.image || p.error) { out = p; break; }
  process.stdout.write(".");
}
console.log();

const url = out?.image || out?.previewUrl;
if (!url) {
  console.error(`no output: ${JSON.stringify(out).slice(0, 400)}`);
  process.exit(1);
}

const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
const file = `/tmp/gltch-work/zimage-${W}x${H}.png`;
writeFileSync(file, buf);

// PNG IHDR: width and height are big-endian uint32 at byte 16 and 20.
const gotW = buf.readUInt32BE(16);
const gotH = buf.readUInt32BE(20);

console.log(`  ${url}`);
console.log(`  saved ${file} (${Math.round(buf.length / 1024)} KB)`);
console.log(`\nrequested ${W}x${H}  ->  returned ${gotW}x${gotH}`);
console.log(gotW === W && gotH === H
  ? "MATCH — the picker reaches the model."
  : "MISMATCH — the workflow is overriding the requested size.");
process.exit(gotW === W && gotH === H ? 0 : 1);
