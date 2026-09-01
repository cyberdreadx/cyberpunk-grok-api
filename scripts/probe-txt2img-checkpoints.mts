/**
 * Which of the worker's checkpoints actually run through the v1 txt2img
 * pipeline (CheckpointLoaderSimple → CLIPTextEncode → KSampler → VAEDecode)?
 *
 * The names now exist on the worker, but existing is not the same as being
 * loadable by that vanilla graph — Qwen and Z-Image models want their own.
 * Whichever one wins should be first in COMFYUI_MODELS, because v1/comfy.ts
 * uses checkpoints[0] when the caller omits `checkpoint`.
 *
 * A failed generation refunds; only a success costs 3 credits.
 */
process.env.RESEND_API_KEY = "";

import { createHash, randomBytes } from "crypto";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";

const [owner] = await sql`
  SELECT id, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1`;
console.log(`starting credits: ${owner.credits}\n`);

const raw = `gltch_sk_${randomBytes(24).toString("hex")}`;
const [key] = await sql`
  INSERT INTO api_keys (user_id, key_hash, name, key_prefix)
  VALUES (${owner.id}::uuid, ${createHash("sha256").update(raw).digest("hex")},
          'checkpoint probe (temporary)', ${raw.slice(0, 16)})
  RETURNING id`;

const CHECKPOINTS = [
  "Qwen-Rapid-AIO-v1.safetensors",
  "fluxNSFWUNLOCKED_v20FP16.safetensors",
  "Qwen-Rapid-AIO-NSFW-v19.safetensors",
  "2602-NSFW-BF16.safetensors",
  "ZImageTurbo-2601-fp8.safetensors",
];

const working: string[] = [];
try {
  for (const ckpt of CHECKPOINTS) {
    const t0 = Date.now();
    let line = `  ${ckpt.padEnd(38)}`;
    try {
      const res = await fetch(`${BASE}/api/v1/comfy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": raw },
        body: JSON.stringify({
          prompt: "a neon-lit cyberpunk alley at night",
          workflow: "txt2img",
          checkpoint: ckpt,
          steps: 8,
          width: 512,
          height: 512,
        }),
        signal: AbortSignal.timeout(240000),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      const secs = Math.round((Date.now() - t0) / 1000);
      if (res.ok && data.image_url) {
        working.push(ckpt);
        console.log(`${line} OK   ${secs}s  ${String(data.image_url).slice(0, 60)}`);
      } else {
        console.log(`${line} ${res.status}  ${secs}s  ${(data.error || "").slice(0, 55)}`);
      }
    } catch (e: any) {
      console.log(`${line} ERR  ${e.message?.slice(0, 50)}`);
    }
  }
} finally {
  await sql`DELETE FROM api_keys WHERE id = ${key.id}::uuid`;
}

const [after] = await sql`
  SELECT daily_credits + sub_credits + pack_credits AS credits FROM users WHERE id = ${owner.id}::uuid`;
console.log(`\nworking checkpoints: ${working.length ? working.join(", ") : "NONE"}`);
console.log(`credits ${owner.credits} → ${after.credits} (spent ${Number(owner.credits) - Number(after.credits)})`);
process.exit(0);
