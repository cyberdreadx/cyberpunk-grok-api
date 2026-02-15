/**
 * /api/comfyui - ComfyUI proxy (admin-only for now).
 *
 * Supports two backends:
 *   1. RunPod Serverless (RUNPOD_ENDPOINT_ID + RUNPOD_API_KEY) — cloud GPU
 *   2. Local ComfyUI (COMFYUI_URL) — direct connection via tunnel
 *
 * POST { action: "status" }    - health check
 * POST { action: "models" }    - list available checkpoints
 * POST { action: "generate" }  - submit workflow, return jobId + seed
 * POST { action: "poll" }      - check job status, return base64 image when done
 *
 * All actions require admin JWT.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";

const ADMIN_EMAIL = "cyberdreadx@proton.me";

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

// ---- Backend detection ----

type Backend = "runpod" | "local";

function getBackend(): { mode: Backend; runpodEndpoint?: string; runpodKey?: string; comfyUrl?: string } {
  const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
  const runpodKey = process.env.RUNPOD_API_KEY;
  if (runpodEndpoint && runpodKey) {
    return { mode: "runpod", runpodEndpoint, runpodKey };
  }
  const comfyUrl = process.env.COMFYUI_URL;
  if (comfyUrl) {
    return { mode: "local", comfyUrl: comfyUrl.replace(/\/+$/, "") };
  }
  return { mode: "local" };
}

// ---- Workflow builders ----

function buildTxt2ImgWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  checkpoint: string;
}): Record<string, any> {
  return {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: p.checkpoint },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: p.prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: p.negativePrompt || "", clip: ["4", 1] },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "GrokRunner", images: ["8", 0] },
    },
  };
}

/**
 * Qwen Image Edit workflow (API format).
 * Derived from the user's "Normal NSFW Qwen edit" ComfyUI workflow.
 *
 * Flow: LoadImage -> TextEncodeQwenImageEditPlus (positive + negative)
 *       -> ModelSamplingAuraFlow -> CFGNorm -> KSampler -> cleanGpu -> VAEDecode -> SaveImage
 */
const QWEN_DEFAULT_NEGATIVE = "smooth skin, drawn, cgi, fake, cartoon, ugly, disfigured, sfx";

function buildQwenEditWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  checkpoint: string;
  upscale?: boolean;
}): Record<string, any> {
  return {
    "125": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: p.checkpoint },
    },
    "123": {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename },
    },
    "132": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["125", 1],
        vae: ["125", 2],
        image1: ["123", 0],
        prompt: p.prompt,
      },
    },
    "133": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["125", 1],
        vae: ["125", 2],
        prompt: p.negativePrompt,
      },
    },
    "64": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: ["125", 0], shift: 3 },
    },
    "65": {
      class_type: "CFGNorm",
      inputs: { model: ["64", 0], strength: 1 },
    },
    "148": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: 1 },
    },
    "75": {
      class_type: "KSampler",
      inputs: {
        model: ["65", 0],
        positive: ["132", 0],
        negative: ["133", 0],
        latent_image: ["148", 0],
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "sa_solver",
        scheduler: "beta",
        denoise: 1,
      },
    },
    "72": {
      class_type: "easy cleanGpuUsed",
      inputs: { anything: ["75", 0] },
    },
    "73": {
      class_type: "VAEDecode",
      inputs: { samples: ["72", 0], vae: ["125", 2] },
    },
    "77": {
      class_type: "SaveImage",
      inputs: { images: ["73", 0], filename_prefix: "GrokRunner" },
    },
    ...(p.upscale ? {
      "128": {
        class_type: "UpscaleModelLoader",
        inputs: { model_name: "4x_foolhardy_Remacri.pth" },
      },
      "126": {
        class_type: "UltimateSDUpscale",
        inputs: {
          image: ["73", 0],
          model: ["125", 0],
          positive: ["132", 0],
          negative: ["133", 0],
          vae: ["125", 2],
          upscale_model: ["128", 0],
          upscale_by: 1.5,
          seed: p.seed,
          steps: 6,
          cfg: p.cfg,
          sampler_name: "sa_solver",
          scheduler: "simple",
          denoise: 0.2,
          mode_type: "Linear",
          tile_width: 1024,
          tile_height: 1024,
          mask_blur: 8,
          tile_padding: 32,
          seam_fix_mode: "None",
          seam_fix_denoise: 1,
          seam_fix_width: 64,
          seam_fix_mask_blur: 8,
          seam_fix_padding: 16,
          force_uniform_tiles: true,
          tiled_decode: false,
        },
      },
      "200": {
        class_type: "SaveImage",
        inputs: { images: ["126", 0], filename_prefix: "GrokRunner_HD" },
      },
    } : {}),
  };
}

// ---- RunPod helpers ----

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

async function runpodRequest(
  endpoint: string,
  apiKey: string,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: any,
) {
  const url = `${RUNPOD_API_BASE}/${endpoint}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

// ---- Local ComfyUI helpers ----

async function uploadImageToLocal(baseUrl: string, imageBase64: string, rawName: string) {
  const base64Clean = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(base64Clean, "base64");

  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const ext = isJpeg ? "jpg" : isPng ? "png" : "png";
  const ct = isJpeg ? "image/jpeg" : "image/png";
  const fname = rawName || `upload_${Date.now()}.${ext}`;

  const boundary = `----ComfyUpload${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: ${ct}\r\n\r\n`
  );
  const footer = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`
  );
  const body = Buffer.concat([header, buf, footer]);

  const resp = await fetch(`${baseUrl}/upload/image`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Upload failed");
    throw new Error(`Image upload failed (${resp.status}): ${errText}`);
  }
  const result = await resp.json();
  return result.name as string;
}

// =============== Handler ===============

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const backend = getBackend();
  if (backend.mode === "local" && !backend.comfyUrl) {
    return res.status(500).json({ error: "No ComfyUI backend configured. Set RUNPOD_ENDPOINT_ID + RUNPOD_API_KEY or COMFYUI_URL." });
  }

  const { action } = req.body || {};

  try {
    // ========== STATUS ==========
    if (action === "status") {
      if (backend.mode === "runpod") {
        const resp = await runpodRequest(backend.runpodEndpoint!, backend.runpodKey!, "/health");
        if (!resp.ok) throw new Error(`RunPod health returned ${resp.status}`);
        const data = await resp.json();
        // RunPod health returns { jobs: { completed, failed, inProgress, inQueue, retried }, workers: { idle, initializing, ready, running, throttled } }
        return res.status(200).json({
          connected: true,
          backend: "runpod",
          stats: data,
        });
      } else {
        const resp = await fetch(`${backend.comfyUrl}/system_stats`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) throw new Error(`ComfyUI returned ${resp.status}`);
        const stats = await resp.json();
        return res.status(200).json({ connected: true, backend: "local", stats });
      }
    }

    // ========== MODELS ==========
    if (action === "models") {
      if (backend.mode === "runpod") {
        // Models are baked into the Docker image. Use COMFYUI_MODELS env var
        // or return a sensible default.
        const modelsEnv = process.env.COMFYUI_MODELS || "";
        const checkpoints = modelsEnv
          ? modelsEnv.split(",").map((m) => m.trim()).filter(Boolean)
          : ["model.safetensors"]; // placeholder — update COMFYUI_MODELS env var
        return res.status(200).json({ checkpoints });
      } else {
        const resp = await fetch(
          `${backend.comfyUrl}/object_info/CheckpointLoaderSimple`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!resp.ok) throw new Error(`ComfyUI returned ${resp.status}`);
        const info = await resp.json();
        const checkpoints: string[] =
          info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        return res.status(200).json({ checkpoints });
      }
    }

    // ========== GENERATE ==========
    if (action === "generate") {
      const {
        workflow: workflowType = "txt2img",
        prompt,
        negativePrompt = "",
        width = 512,
        height = 512,
        seed,
        steps = 20,
        cfg = 7,
        checkpoint,
        imageBase64,
        imageFilename: clientFilename,
        upscale,
      } = req.body;

      if (!prompt)
        return res.status(400).json({ error: "Prompt is required" });
      if (!checkpoint)
        return res.status(400).json({ error: "Checkpoint is required" });

      const actualSeed =
        seed != null && seed !== ""
          ? Number(seed)
          : Math.floor(Math.random() * 2 ** 32);

      const clampW = Math.min(2048, Math.max(256, Number(width)));
      const clampH = Math.min(2048, Math.max(256, Number(height)));
      const clampSteps = Math.min(100, Math.max(1, Number(steps)));
      const clampCfg = Math.min(30, Math.max(0.1, Number(cfg)));

      // Determine image filename for workflow
      let imageFilename: string | undefined;

      if (workflowType === "qwen-edit") {
        if (!imageBase64 && !clientFilename) {
          return res.status(400).json({ error: "Image is required for qwen-edit" });
        }

        if (backend.mode === "runpod") {
          // For RunPod, use a consistent filename — image data goes in images array
          imageFilename = clientFilename || `input_edit_${Date.now()}.jpg`;
        } else {
          // For local, upload the image to ComfyUI's input folder
          if (imageBase64) {
            imageFilename = await uploadImageToLocal(
              backend.comfyUrl!,
              imageBase64,
              clientFilename || `input_edit_${Date.now()}.jpg`,
            );
          } else {
            // clientFilename was already uploaded via a prior call
            imageFilename = clientFilename;
          }
        }
      }

      // Build the workflow
      let workflow: Record<string, any>;
      if (workflowType === "qwen-edit") {
        workflow = buildQwenEditWorkflow({
          prompt: prompt.trim(),
          negativePrompt: (negativePrompt || "").trim() || QWEN_DEFAULT_NEGATIVE,
          imageFilename: imageFilename!,
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: clampSteps,
          cfg: clampCfg,
          checkpoint,
          upscale: !!upscale,
        });
      } else {
        workflow = buildTxt2ImgWorkflow({
          prompt: prompt.trim(),
          negativePrompt: (negativePrompt || "").trim(),
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: clampSteps,
          cfg: clampCfg,
          checkpoint,
        });
      }

      // Submit to the appropriate backend
      if (backend.mode === "runpod") {
        // Build RunPod input payload
        const runpodInput: any = { workflow };

        // Include input image if editing
        if (workflowType === "qwen-edit" && imageBase64) {
          runpodInput.images = [
            {
              name: imageFilename!,
              image: imageBase64, // data URI or raw base64 — RunPod handles both
            },
          ];
        }

        const resp = await runpodRequest(
          backend.runpodEndpoint!,
          backend.runpodKey!,
          "/run",
          "POST",
          { input: runpodInput },
        );

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "Unknown error");
          throw new Error(`RunPod submit failed (${resp.status}): ${errText}`);
        }

        const result = await resp.json();
        return res.status(200).json({
          promptId: result.id, // RunPod job ID
          seed: actualSeed,
          backend: "runpod",
        });
      } else {
        // Local ComfyUI
        const resp = await fetch(`${backend.comfyUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: workflow }),
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "Unknown error");
          throw new Error(`ComfyUI prompt failed (${resp.status}): ${errText}`);
        }

        const result = await resp.json();
        return res.status(200).json({
          promptId: result.prompt_id,
          seed: actualSeed,
          backend: "local",
        });
      }
    }

    // ========== POLL ==========
    if (action === "poll") {
      const { promptId } = req.body;
      if (!promptId)
        return res.status(400).json({ error: "promptId is required" });

      if (backend.mode === "runpod") {
        const resp = await runpodRequest(
          backend.runpodEndpoint!,
          backend.runpodKey!,
          `/status/${promptId}`,
        );
        if (!resp.ok) throw new Error(`RunPod status failed (${resp.status})`);

        const data = await resp.json();

        // RunPod statuses: IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED, TIMED_OUT
        if (data.status === "COMPLETED") {
          // Output format (worker-comfyui v5+): { images: [{ filename, type, data }] }
          const images = data.output?.images;
          if (images?.length) {
            const img = images[images.length - 1]; // Take last image (HD if upscaled)
            const base64Data = img.data;
            // If it's already a data URI, use as-is; otherwise wrap it
            const imageUri = base64Data.startsWith("data:")
              ? base64Data
              : `data:image/png;base64,${base64Data}`;
            return res.status(200).json({ status: "done", image: imageUri });
          }
          // Fallback: check older output format (message field)
          if (data.output?.message) {
            const msg = data.output.message;
            const imageUri = msg.startsWith("data:") ? msg : `data:image/png;base64,${msg}`;
            return res.status(200).json({ status: "done", image: imageUri });
          }
          return res.status(200).json({ status: "error", error: "Job completed but no image in output" });
        }

        if (data.status === "FAILED" || data.status === "CANCELLED" || data.status === "TIMED_OUT") {
          const errMsg = data.error || data.output?.error || `Job ${data.status.toLowerCase()}`;
          return res.status(200).json({ status: "error", error: errMsg });
        }

        // IN_QUEUE or IN_PROGRESS
        return res.status(200).json({
          status: "pending",
          runpodStatus: data.status,
          delayTime: data.delayTime,
          executionTime: data.executionTime,
        });
      } else {
        // Local ComfyUI polling
        const resp = await fetch(`${backend.comfyUrl}/history/${promptId}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok)
          throw new Error(`ComfyUI history failed (${resp.status})`);

        const history = await resp.json();
        const entry = history[promptId];

        if (!entry) {
          return res.status(200).json({ status: "pending" });
        }

        if (entry.status?.status_str === "error") {
          const msgs = entry.status?.messages;
          const errStr = Array.isArray(msgs)
            ? msgs.map((m: any) => (typeof m === "string" ? m : JSON.stringify(m))).join(", ")
            : "Generation failed";
          return res.status(200).json({ status: "error", error: errStr });
        }

        const outputs = entry.outputs || {};
        for (const nodeId of Object.keys(outputs)) {
          const images = outputs[nodeId]?.images;
          if (images?.length) {
            const img = images[0];
            const params = new URLSearchParams({
              filename: img.filename,
              subfolder: img.subfolder || "",
              type: img.type || "output",
            });

            const imgResp = await fetch(`${backend.comfyUrl}/view?${params}`, {
              signal: AbortSignal.timeout(10000),
            });
            if (!imgResp.ok)
              throw new Error(`Failed to fetch image (${imgResp.status})`);

            const buffer = await imgResp.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            const ct = imgResp.headers.get("content-type") || "image/png";

            return res.status(200).json({
              status: "done",
              image: `data:${ct};base64,${base64}`,
            });
          }
        }

        return res.status(200).json({ status: "pending" });
      }
    }

    // ========== UPLOAD-IMAGE (legacy, local-only) ==========
    if (action === "upload-image") {
      if (backend.mode === "runpod") {
        // RunPod doesn't need separate uploads — images go with the generate call
        return res.status(200).json({
          filename: req.body.filename || `upload_${Date.now()}.jpg`,
          info: "RunPod mode: image will be sent with generate request",
        });
      }

      const { imageBase64, filename: rawName } = req.body;
      if (!imageBase64)
        return res.status(400).json({ error: "imageBase64 is required" });

      const fname = await uploadImageToLocal(backend.comfyUrl!, imageBase64, rawName);
      return res.status(200).json({ filename: fname, subfolder: "", type: "input" });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error("[comfyui]", err.message);

    const isTimeout =
      err.name === "TimeoutError" || err.message?.includes("timeout");
    const isConn =
      err.cause?.code === "ECONNREFUSED" ||
      err.message?.includes("ECONNREFUSED") ||
      err.message?.includes("fetch failed");

    if (isTimeout || isConn) {
      return res.status(502).json({
        error: backend.mode === "runpod"
          ? "RunPod endpoint not responding. Check endpoint status."
          : "Cannot reach ComfyUI. Check tunnel and local server.",
      });
    }

    return res.status(500).json({ error: err.message || "ComfyUI request failed" });
  }
}
