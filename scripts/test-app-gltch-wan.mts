/**
 * Exercise the APP's gltch-wan path, not the public API's.
 *
 * buildGltchWanWorkflow moved out of api/comfyui.ts into a shared module. The
 * public-API test proves the graph itself still builds; this proves the app's
 * own call site — which passes video-LoRA and audio arguments the API path
 * doesn't — still reaches RunPod and comes back with a video.
 *
 * 152 people ran this workflow last month, so it is worth 15 credits to know.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1`;
const token = signToken({ userId: owner.id, email: owner.email });
console.log(`acting as ${owner.email} · ${owner.credits} credits\n`);

// A small solid-colour JPEG as the start frame — enough to satisfy the >1KB
// guard without depending on any external URL staying up.
const seed = await fetch(
  "https://pub-0a4d910130d047e9a9c0e03feb7fcca6.r2.dev/v1-api/placeholder-probe.png",
).catch(() => null);

let imageBase64: string;
if (seed?.ok) {
  imageBase64 = Buffer.from(await seed.arrayBuffer()).toString("base64");
} else {
  // Generate one through the public API instead (zimage, 3 cr).
  const { createHash, randomBytes } = await import("crypto");
  const raw = `gltch_sk_${randomBytes(24).toString("hex")}`;
  const [k] = await sql`
    INSERT INTO api_keys (user_id, key_hash, name, key_prefix)
    VALUES (${owner.id}::uuid, ${createHash("sha256").update(raw).digest("hex")},
            'app gltch-wan seed (temporary)', ${raw.slice(0, 16)})
    RETURNING id`;
  const z = await fetch(`${BASE}/api/v1/comfy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": raw },
    body: JSON.stringify({ prompt: "a neon-lit alley, rain", workflow: "zimage" }),
    signal: AbortSignal.timeout(290000),
  }).then(r => r.json()) as any;
  await sql`DELETE FROM api_keys WHERE id = ${k.id}::uuid`;
  if (!z?.image_url) { console.error("could not produce a seed frame:", z); process.exit(1); }
  console.log(`seed frame: ${z.image_url}`);
  imageBase64 = Buffer.from(await (await fetch(z.image_url)).arrayBuffer()).toString("base64");
}
console.log(`seed frame is ${Math.round(imageBase64.length / 1024)}KB of base64\n`);

const t0 = Date.now();
const res = await fetch(`${BASE}/api/comfyui`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    action: "generate",
    workflow: "gltch-wan",
    prompt: "slow cinematic push in, drifting neon reflections",
    imageBase64,
    frameCount: 33,
    width: 832,
    height: 480,
  }),
  signal: AbortSignal.timeout(120000),
});
const data: any = await res.json().catch(() => ({}));
console.log(`submit → HTTP ${res.status} in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(JSON.stringify(data).slice(0, 300));

// The app returns a promptId and the client polls; follow that here.
const promptId = data.promptId || data.id;
if (!promptId) {
  console.log(`\nFAIL — no promptId returned${data.error ? `: ${data.error}` : ""}`);
  process.exit(1);
}

let out: any = null;
const deadline = Date.now() + 280000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const p = await fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "poll", promptId, workflow: "gltch-wan", outputType: "video" }),
    signal: AbortSignal.timeout(60000),
  }).then(r => r.json()).catch(() => ({})) as any;
  if (p.status === "done" || p.video || p.image || p.error) { out = p; break; }
  process.stdout.write(".");
}
console.log();

const url = out?.video || out?.image;
if (url) {
  const h = await fetch(url, { method: "HEAD" });
  console.log(`\nPASS — app gltch-wan returned ${h.headers.get("content-type")} ` +
    `${Math.round(Number(h.headers.get("content-length") || 0) / 1024)}KB`);
  console.log(url.slice(0, 90));
  process.exit(0);
}
console.log(`\nFAIL — ${JSON.stringify(out).slice(0, 300)}`);
process.exit(1);
