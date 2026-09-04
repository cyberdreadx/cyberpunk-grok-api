/**
 * Does a LoRA change the output, or merely load without complaining?
 *
 * "The job succeeded" proves nothing here. ComfyUI accepts a LoRA whose keys
 * match nothing in the model, applies zero tensors and returns a perfectly
 * good unmodified image — which is exactly how three qwen_image LoRAs sat in
 * the Klein edit picker doing nothing while every test generation passed.
 *
 * The only honest check is the same seed with and without, compared pixel by
 * pixel. Identical output means the LoRA did nothing.
 *
 *   node --env-file=.env --import tsx scripts/lora-effect-check.mts <loraName> [strength]
 *
 * 6 credits.
 */
process.env.RESEND_API_KEY = "";

import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const LORA = process.argv[2];
const STRENGTH = Number(process.argv[3]) || 0.8;
const SRC = "/tmp/gltch-work/quant-q8-crop.png";
const WF = process.argv[4] || "klein";
if (!LORA) { console.error("usage: lora-effect-check.mts <loraName> [strength]"); process.exit(1); }

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
const imageBase64 = readFileSync(SRC).toString("base64");
const SEED = 909090;

const post = (body: any) =>
  fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) })) as Promise<any>;

async function run(label: string, withLora: boolean): Promise<string | null> {
  const sub = await post({
    action: "generate", workflow: WF,
    prompt: WF === "krea2" ? "a portrait of a woman on a city street" : "a photograph of a woman, natural skin",
    // krea2 is text-to-image; sending it a source image would be ignored.
    ...(WF === "krea2" ? { width: 1024, height: 1024 } : { imageBase64, imageFilename: "probe.png" }),
    seed: SEED, steps: 8, cfg: WF === "krea2" ? 1 : 5,
    // The two paths take different shapes: klein reads a `loras` array,
    // krea2 reads singular `lora`/`loraStrength`. Sending the wrong one is
    // silently a no-LoRA run, which looks exactly like a LoRA that does
    // nothing — this script reported 0.0 for a working adapter until this
    // was fixed.
    ...(withLora
      ? (WF === "krea2"
        ? { lora: LORA, loraStrength: STRENGTH }
        : { loras: [{ name: LORA, strengthModel: STRENGTH, strengthClip: STRENGTH }] })
      : {}),
  });
  if (!sub.promptId) { console.log(`${label}: submit failed`); return null; }
  process.stdout.write(`${label} `);
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    // Submit's endpoint must be echoed back or the status lookup 404s.
    const p = await post({
      action: "poll", promptId: sub.promptId, outputType: "image",
      runpodEndpointId: sub.runpodEndpointId,
    });
    if (p.error) { console.log(`failed: ${String(p.error).slice(0, 120)}`); return null; }
    if (p.status === "done" || p.image) {
      const url = p.image || p.previewUrl;
      const f = `/tmp/gltch-work/loraeff-${label}.png`;
      writeFileSync(f, Buffer.from(await (await fetch(url)).arrayBuffer()));
      console.log("ok");
      return f;
    }
    process.stdout.write(".");
  }
  console.log("timed out");
  return null;
}

console.log(`${LORA} @ ${STRENGTH}, seed ${SEED}\n`);
const off = await run("off", false);
const on = await run("on", true);
if (!off || !on) process.exit(1);

// Mean absolute difference over the two frames. Same seed and prompt means an
// applied LoRA is the only thing that can move these pixels.
const diff = execFileSync("/tmp/gltch-work/venv/bin/python3", ["-c", `
import numpy as np
from PIL import Image
a=np.asarray(Image.open("${off}").convert("L"),dtype=np.float32)
b=np.asarray(Image.open("${on}").convert("L"),dtype=np.float32)
if a.shape!=b.shape: print("SHAPE", a.shape, b.shape); raise SystemExit
print(round(float(np.abs(a-b).mean()),4))
`]).toString().trim();

console.log(`\nmean pixel difference: ${diff}`);
const d = Number(diff);
console.log(d < 0.01
  ? "NO EFFECT — the LoRA loaded but changed nothing. Wrong architecture for this model."
  : d < 1
    ? "barely any effect — check the strength, or the match is poor"
    : "APPLIED — the LoRA measurably changes the output.");
process.exit(0);
