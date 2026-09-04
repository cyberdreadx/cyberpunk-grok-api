/**
 * Can Klein edit run at 8 steps with the turbo adapter instead of 20 without?
 *
 * Klein has run at 20 steps / cfg 5 since the March migration.
 * klein_9B_Turbo_r128 is a step-count accelerator that has been on the volume
 * unused. If 8 steps with it matches 20 without, every edit costs less than
 * half the GPU time for the same 3 credits.
 *
 * Each configuration renders twice and only the second is timed. The first is
 * a throwaway: LTX timings earlier in this project were compared across a cold
 * and a warm worker, and the "6% slower" conclusion that produced was really
 * measuring a 22.8 GB model load.
 *
 *   node --env-file=.env --import tsx scripts/klein-turbo-check.mts
 *
 * ~12 credits.
 */
process.env.RESEND_API_KEY = "";

import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const SRC = "/tmp/gltch-work/quant-q8-crop.png";
const SEED = 606060;
const PROMPT = "the same woman, wearing a red leather jacket";
const TURBO = "klein_9B_Turbo_r128.safetensors";

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

async function run(label: string, steps: number, cfg: number, turbo: boolean) {
  const t0 = Date.now();
  const sub = await post({
    action: "generate", workflow: "klein",
    prompt: PROMPT, imageBase64, imageFilename: "probe.png",
    seed: SEED, steps, cfg,
    ...(turbo ? { loras: [{ name: TURBO, strengthModel: 1.0, strengthClip: 1.0 }] } : {}),
  });
  if (!sub.promptId) { console.log(`${label}: submit failed`); return null; }
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    // Submit's endpoint must be echoed back or the status lookup 404s.
    const p = await post({
      action: "poll", promptId: sub.promptId, outputType: "image",
      runpodEndpointId: sub.runpodEndpointId,
    });
    if (p.error) { console.log(`${label}: failed ${String(p.error).slice(0, 90)}`); return null; }
    if (p.status === "done" || p.image) {
      const f = `/tmp/gltch-work/kturbo-${label}.png`;
      writeFileSync(f, Buffer.from(await (await fetch(p.image || p.previewUrl)).arrayBuffer()));
      return { file: f, secs: Math.round((Date.now() - t0) / 1000) };
    }
  }
  console.log(`${label}: timed out`);
  return null;
}

console.log(`${owner.email}, ${owner.credits} credits · seed ${SEED}\n`);

const CONFIGS = [
  { label: "base-20", steps: 20, cfg: 5, turbo: false },
  { label: "turbo-8", steps: 8, cfg: 1, turbo: true },
];

const results: Record<string, { file: string; secs: number }> = {};
for (const c of CONFIGS) {
  // Warm the worker for this configuration, then time the second run.
  await run(`${c.label}-warm`, c.steps, c.cfg, c.turbo);
  const r = await run(c.label, c.steps, c.cfg, c.turbo);
  if (!r) process.exit(1);
  results[c.label] = r;
  console.log(`${c.label.padEnd(10)} ${String(c.steps).padStart(2)} steps cfg ${c.cfg}  ${r.secs}s`);
}

const a = results["base-20"], b = results["turbo-8"];
console.log(`\ntime: ${b.secs}s vs ${a.secs}s — ${(a.secs / Math.max(1, b.secs)).toFixed(2)}x faster`);

// Different steps means a different trajectory, so these will never be
// identical. The question is whether the turbo result is comparable quality,
// which is a judgement — this only reports how far apart they are.
const diff = execFileSync("/tmp/gltch-work/venv/bin/python3", ["-c", `
import numpy as np
from PIL import Image
x=np.asarray(Image.open("${a.file}").convert("L"),dtype=np.float32)
y=np.asarray(Image.open("${b.file}").convert("L"),dtype=np.float32)
print(round(float(np.abs(x-y).mean()),2) if x.shape==y.shape else "shape mismatch")
`]).toString().trim();
console.log(`mean pixel difference between the two: ${diff}`);
console.log(`\nfiles: ${a.file}  ${b.file}  — compare them by eye, not by that number.`);
process.exit(0);
