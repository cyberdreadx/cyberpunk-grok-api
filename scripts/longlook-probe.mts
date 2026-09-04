/**
 * Reproduce the LongLook failure and capture the actual error.
 *
 * usage_log shows it last succeeded on 2026-09-01. There is a dedicated
 * RUNPOD_LONGLOOK_ENDPOINT, but RUNPOD_LONGLOOK_ENDPOINT_ID has never been set
 * in .env, so getEndpointForWorkflow falls through to the WAN endpoint. This
 * submits a real LongLook job and prints whatever comes back rather than
 * inferring the cause from that.
 *
 *   node --env-file=.env --import tsx scripts/longlook-probe.mts
 *
 * Refunds on failure.
 */
process.env.RESEND_API_KEY = "";

import { readFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const SRC = "/tmp/gltch-work/quant-q8-crop.png";

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
const imageBase64 = readFileSync(SRC).toString("base64");

const post = (body: any) =>
  fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) })) as Promise<any>;

console.log(`${owner.email}, ${owner.credits} credits`);
console.log(`RUNPOD_LONGLOOK_ENDPOINT_ID = ${process.env.RUNPOD_LONGLOOK_ENDPOINT_ID || "(unset -> falls back to WAN)"}\n`);

// Exactly what Index.tsx sends. The first version of this probe used a
// stripped-down payload and succeeded, which proved only that the workflow
// exists — the UI adds motionScale, RIFE, an upscale pass and optional audio,
// any of which could be the actual failure.
const sub = await post({
  action: "generate", workflow: "longlook",
  prompt: "she turns her head slowly",
  imageBase64, imageFilename: "probe.png",
  width: 512, height: 512,
  sequenceCount: 2,          // UI default
  frameCount: 81,            // UI default
  steps: 4, cfg: 1,
  motionScale: 1.5,          // UI default
  useRife: true, useUpscale: true,
  audioMode: "none",
});
console.log("submit:", JSON.stringify(sub).slice(0, 400));
if (!sub.promptId) process.exit(1);
console.log(`endpoint used: ${sub.runpodEndpointId}`);

const deadline = Date.now() + 480000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  const p = await post({
    action: "poll", promptId: sub.promptId, outputType: "video",
    runpodEndpointId: sub.runpodEndpointId,
  });
  if (p.error) { console.log(`\nFAILED: ${String(p.error).slice(0, 700)}`); process.exit(1); }
  if (p.status === "done" || p.video || p.image) {
    console.log(`\nSUCCEEDED — ${p.video || p.image ? "output returned" : "no media"}`);
    process.exit(0);
  }
  process.stdout.write(".");
}
console.log("\ntimed out");
process.exit(1);
