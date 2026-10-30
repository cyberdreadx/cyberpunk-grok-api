/**
 * Copy the models each Vast.ai pool needs from the RunPod network volume
 * (RunPod S3 gateway) into R2, and record them in vast_models.
 *
 * Vast machines download from R2 with short-lived signed URLs handed out by
 * /api/vast-worker. Keys live under VAST_MODELS_PREFIX, a random folder that
 * no cleanup cron sweeps. Re-running skips files already copied at the same
 * size, so it's safe to run again after adding a LoRA.
 *
 * RunPod S3 can't LIST, so each file's folder is found by HEAD-probing the
 * usual ComfyUI model folders.
 *
 *   node --env-file=.env --import tsx scripts/vast-sync-models.mts            # dry run: find + size
 *   node --env-file=.env --import tsx scripts/vast-sync-models.mts --apply    # copy
 *   ... --pool=image                                                         # one pool only
 *   ... --list-json      print {pool: [filenames]} (input for a pod-side copy)
 *   ... --from-r2 --apply  register files already copied into R2 (by a RunPod CPU
 *                          pod with the volume mounted) when the S3 gateway is down
 */
import {
  S3Client, HeadObjectCommand, GetObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { ensureVastTables, type PoolName } from "/home/neon/cyberpunk-grok-api/api/_lib/vast.ts";

const APPLY = process.argv.includes("--apply");
const FROM_R2 = process.argv.includes("--from-r2");
const ONLY = process.argv.find((a) => a.startsWith("--pool="))?.split("=")[1] as PoolName | undefined;
const PREFIX = (process.env.VAST_MODELS_PREFIX || "").replace(/\/+$/, "");
if (!PREFIX) { console.error("VAST_MODELS_PREFIX is not set"); process.exit(1); }

const env = (k: string) => (process.env[k] || "").split(",").map((s) => s.trim()).filter(Boolean);

// What each pool loads. Literals mirror the workflow builders in api/comfyui.ts
// and api/_lib/comfy-workflows.ts; LoRA lists come from the same env vars the
// app offers in its pickers.
const POOL_FILES: Record<PoolName, string[]> = {
  image: [
    "flux-2-klein-9b-nvfp4.safetensors", "flux2-vae.safetensors", "qwen_3_8b_fp8mixed.safetensors",
    "klein_slider_anatomy.safetensors",
    "z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "ae.safetensors",
    "krea2_turbo_fp8_scaled.safetensors", "qwen3vl_4b_fp8_scaled.safetensors", "qwen_image_vae.safetensors",
    "klein_snofs_v1_4.safetensors", "KLEIN-Unchained-V2.safetensors", "klein-deepthroat-15epoc-k3nk.safetensors",
    "cowgirl_20260123_04-36-14epoch35.safetensors", "bj_20260120_22-22-29epoch15_comfy.safetensors",
    "realcumk4.safetensors",
    ...env("COMFYUI_MODELS"), ...env("COMFYUI_LORAS"), ...env("COMFYUI_EDIT_LORAS"),
    ...env("COMFYUI_KREA2_LORAS"), ...env("COMFYUI_QWEN_LORAS"),
  ],
  wan: [
    "Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v2.1.safetensors",
    "Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v2.1.safetensors",
    "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "wan_2.1_vae.safetensors", "clip_vision_h.safetensors",
    "smoothMixWan22I2VT2V_i2vHigh-Q6_K.gguf", "smoothMixWan22I2VT2V_i2vLow-Q6_K.gguf",
    "wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8H.gguf", "wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8L.gguf",
    "wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors",
    "wan2.2_i2v_A14b_low_noise_lora_rank64_lightx2v_4step_1022.safetensors",
    "mmaudio_large_44k_v2_fp16.safetensors", "mmaudio_synchformer_fp16.safetensors",
    "mmaudio_vae_44k_fp16.safetensors", "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors",
    "RealESRGAN_x2plus.pth",
    ...env("COMFYUI_VIDEO_LORAS"),
  ],
  ltx: [
    "ltx-2-3-22b-dev-Q4_K_M.gguf", "gemma_3_12B_it_fp4_mixed.safetensors",
    "ltx-2.3_text_projection_bf16.safetensors", "LTX23_video_vae_bf16.safetensors",
    "LTX23_audio_vae_bf16.safetensors",
    "ltx-2.3-22b-distilled-lora-dynamic_fro09_avg_rank_105_bf16.safetensors",
    ...env("COMFYUI_LTX_LORAS"),
  ],
};

const FOLDERS = [
  "diffusion_models", "unet", "checkpoints", "loras", "text_encoders", "clip", "vae",
  "clip_vision", "upscale_models", "latent_upscale_models", "mmaudio", "model_patches",
];
const VOL_ROOT = "runpod-slim/ComfyUI/models";

const rp = new S3Client({
  region: "us-nc-1",
  endpoint: process.env.RUNPOD_S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.RUNPOD_S3_ACCESS_KEY!, secretAccessKey: process.env.RUNPOD_S3_SECRET_KEY! },
});
const RP_BUCKET = process.env.RUNPOD_S3_BUCKET || "qhbgw8nx2v";
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || "grokker-media";

async function head(client: S3Client, Bucket: string, Key: string): Promise<number | null> {
  try { return Number((await client.send(new HeadObjectCommand({ Bucket, Key }))).ContentLength ?? 0); }
  catch { return null; }
}

async function locate(file: string): Promise<{ path: string; size: number } | null> {
  if (FROM_R2) {
    for (const f of FOLDERS) {
      const size = await head(r2, R2_BUCKET, `${PREFIX}/${f}/${file}`);
      if (size != null) return { path: `${f}/${file}`, size };
    }
    return null;
  }
  for (const f of FOLDERS) {
    const size = await head(rp, RP_BUCKET, `${VOL_ROOT}/${f}/${file}`);
    if (size != null) return { path: `${f}/${file}`, size };
  }
  return null;
}

const PART = 128 * 1024 * 1024;
async function copy(path: string, size: number) {
  const src = `${VOL_ROOT}/${path}`;
  const dst = `${PREFIX}/${path}`;
  const { UploadId } = await r2.send(new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: dst }));
  const parts: { PartNumber: number; ETag: string }[] = [];
  try {
    const n = Math.max(1, Math.ceil(size / PART));
    let next = 0;
    const worker = async () => {
      while (next < n) {
        const i = next++;
        const start = i * PART, end = Math.min(size, start + PART) - 1;
        for (let attempt = 0; ; attempt++) {
          try {
            const got = await rp.send(new GetObjectCommand({ Bucket: RP_BUCKET, Key: src, Range: `bytes=${start}-${end}` }));
            const body = Buffer.from(await got.Body!.transformToByteArray());
            const up = await r2.send(new UploadPartCommand({ Bucket: R2_BUCKET, Key: dst, UploadId, PartNumber: i + 1, Body: body }));
            parts[i] = { PartNumber: i + 1, ETag: up.ETag! };
            process.stdout.write(`\r  ${path}: part ${i + 1}/${n}   `);
            break;
          } catch (e: any) {
            if (attempt >= 5) throw e;
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          }
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await r2.send(new CompleteMultipartUploadCommand({ Bucket: R2_BUCKET, Key: dst, UploadId, MultipartUpload: { Parts: parts } }));
    process.stdout.write("\n");
  } catch (e) {
    await r2.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: dst, UploadId })).catch(() => {});
    throw e;
  }
}

if (process.argv.includes("--list-json")) {
  const out: Record<string, string[]> = {};
  for (const [p, f] of Object.entries(POOL_FILES)) out[p] = [...new Set(f)];
  console.log(JSON.stringify(out));
  process.exit(0);
}

await ensureVastTables();
const sql = getDb();
let missing = 0;
for (const pool of (Object.keys(POOL_FILES) as PoolName[]).filter((p) => !ONLY || p === ONLY)) {
  const files = [...new Set(POOL_FILES[pool])];
  let total = 0;
  console.log(`\n== ${pool}: ${files.length} files`);
  for (const file of files) {
    const loc = await locate(file);
    if (!loc) { console.log(`  MISSING ${FROM_R2 ? "in R2" : "on RunPod volume"}: ${file}`); missing++; continue; }
    total += loc.size;
    const have = await head(r2, R2_BUCKET, `${PREFIX}/${loc.path}`);
    const status = have === loc.size ? "in R2" : APPLY ? "copying" : "to copy";
    console.log(`  ${(loc.size / 1e9).toFixed(2).padStart(6)} GB  ${status.padEnd(8)} ${loc.path}`);
    if (!APPLY) continue;
    if (have !== loc.size && !FROM_R2) await copy(loc.path, loc.size);
    await sql`INSERT INTO vast_models (pool, path, r2_key, size_bytes) VALUES (${pool}, ${loc.path}, ${`${PREFIX}/${loc.path}`}, ${loc.size})
              ON CONFLICT (pool, path) DO UPDATE SET r2_key = EXCLUDED.r2_key, size_bytes = EXCLUDED.size_bytes, updated_at = now()`;
  }
  console.log(`  total ${(total / 1e9).toFixed(1)} GB`);
}
console.log(missing ? `\n${missing} file(s) not found — check names/folders.` : "\nall files found.");
if (!APPLY) console.log("(dry run — pass --apply to copy)");
process.exit(0);
