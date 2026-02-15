/**
 * /api/comfyui - Admin-only ComfyUI proxy.
 *
 * POST { action: "status" }       - health check
 * POST { action: "models" }       - list available checkpoints
 * POST { action: "upload-image" } - upload base64 image to ComfyUI input folder
 * POST { action: "generate" }     - submit workflow (txt2img or qwen-edit), return promptId
 * POST { action: "poll" }         - check prompt status, return base64 image when done
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
    // Load checkpoint (Qwen model)
    "125": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: p.checkpoint },
    },
    // Load the input image to edit
    "123": {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename },
    },
    // Positive prompt with image reference
    "132": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["125", 1],
        vae: ["125", 2],
        image1: ["123", 0],
        prompt: p.prompt,
      },
    },
    // Negative prompt
    "133": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["125", 1],
        vae: ["125", 2],
        prompt: p.negativePrompt,
      },
    },
    // AuraFlow sampling adjustment
    "64": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: ["125", 0], shift: 3 },
    },
    // CFG normalization
    "65": {
      class_type: "CFGNorm",
      inputs: { model: ["64", 0], strength: 1 },
    },
    // Empty latent at target resolution
    "148": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: 1 },
    },
    // KSampler
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
    // Clean GPU memory between sampler and decode
    "72": {
      class_type: "easy cleanGpuUsed",
      inputs: { anything: ["75", 0] },
    },
    // Decode latent to image
    "73": {
      class_type: "VAEDecode",
      inputs: { samples: ["72", 0], vae: ["125", 2] },
    },
    // Save base output
    "77": {
      class_type: "SaveImage",
      inputs: { images: ["73", 0], filename_prefix: "GrokRunner" },
    },
    // Upscale nodes (conditionally added)
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const COMFYUI_URL = process.env.COMFYUI_URL;
  if (!COMFYUI_URL) {
    return res.status(500).json({ error: "COMFYUI_URL not configured" });
  }

  const baseUrl = COMFYUI_URL.replace(/\/+$/, "");
  const { action } = req.body || {};

  try {
    // -- Status / health check --
    if (action === "status") {
      const resp = await fetch(`${baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) throw new Error(`ComfyUI returned ${resp.status}`);
      const stats = await resp.json();
      return res.status(200).json({ connected: true, stats });
    }

    // -- List available checkpoints --
    if (action === "models") {
      const resp = await fetch(
        `${baseUrl}/object_info/CheckpointLoaderSimple`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!resp.ok) throw new Error(`ComfyUI returned ${resp.status}`);
      const info = await resp.json();
      const checkpoints: string[] =
        info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
      return res.status(200).json({ checkpoints });
    }

    // -- Upload image to ComfyUI input folder --
    if (action === "upload-image") {
      const { imageBase64, filename: rawName } = req.body;
      if (!imageBase64)
        return res.status(400).json({ error: "imageBase64 is required" });

      // Strip data URI prefix if present
      const base64Clean = imageBase64.replace(/^data:[^;]+;base64,/, "");
      const buf = Buffer.from(base64Clean, "base64");

      // Detect content type
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      const ext = isJpeg ? "jpg" : isPng ? "png" : "png";
      const ct = isJpeg ? "image/jpeg" : "image/png";
      const fname = rawName || `upload_${Date.now()}.${ext}`;

      // Build multipart form data manually
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
      return res.status(200).json({
        filename: result.name,
        subfolder: result.subfolder || "",
        type: result.type || "input",
      });
    }

    // -- Submit generation (txt2img or qwen-edit) --
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
        imageFilename,
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

      let workflow: Record<string, any>;

      if (workflowType === "qwen-edit") {
        if (!imageFilename)
          return res.status(400).json({ error: "imageFilename is required for qwen-edit" });
        workflow = buildQwenEditWorkflow({
          prompt: prompt.trim(),
          negativePrompt: (negativePrompt || "").trim() || QWEN_DEFAULT_NEGATIVE,
          imageFilename,
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

      const resp = await fetch(`${baseUrl}/prompt`, {
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
      return res
        .status(200)
        .json({ promptId: result.prompt_id, seed: actualSeed });
    }

    // -- Poll for completion --
    if (action === "poll") {
      const { promptId } = req.body;
      if (!promptId)
        return res.status(400).json({ error: "promptId is required" });

      const resp = await fetch(`${baseUrl}/history/${promptId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok)
        throw new Error(`ComfyUI history failed (${resp.status})`);

      const history = await resp.json();
      const entry = history[promptId];

      if (!entry) {
        return res.status(200).json({ status: "pending" });
      }

      // ComfyUI reported an error
      if (entry.status?.status_str === "error") {
        const msgs = entry.status?.messages;
        const errStr = Array.isArray(msgs)
          ? msgs
              .map((m: any) => (typeof m === "string" ? m : JSON.stringify(m)))
              .join(", ")
          : "Generation failed";
        return res.status(200).json({ status: "error", error: errStr });
      }

      // Look for output images in any node
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

          const imgResp = await fetch(`${baseUrl}/view?${params}`, {
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

      // Entry exists but no output images yet (still rendering)
      return res.status(200).json({ status: "pending" });
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
        error: "Cannot reach ComfyUI. Check tunnel and local server.",
      });
    }

    return res
      .status(500)
      .json({ error: err.message || "ComfyUI request failed" });
  }
}
