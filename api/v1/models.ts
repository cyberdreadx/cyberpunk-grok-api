/**
 * /api/v1/models — List available models and their credit costs.
 *
 * Auth: X-API-Key header.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const auth = await getUserFromApiKey(req);
  if (!auth) {
    return res.status(401).json({ error: "Invalid or missing API key." });
  }

  // Grok models — retired from the public API (BYOK-only on the site since
  // 2026-06-14; /v1/generate would bill xAI on the platform key). Only listed
  // if explicitly re-enabled.
  const grokEnabled = process.env.V1_GROK_ENABLED === "1";
  const grokModels = [
    { id: "grok-imagine-image", type: "image", credits_per_unit: 4, description: "Standard quality image generation" },
    { id: "grok-imagine-image-pro", type: "image", credits_per_unit: 10, description: "Higher quality image generation" },
    { id: "grok-imagine-video", type: "video", credits_per_unit: 30, description: "5-second video generation (6 cr/sec)" },
    { id: "grok-imagine-video-10s", type: "video", credits_per_unit: 60, description: "10-second video generation (6 cr/sec)" },
  ];

  // GLTCH models
  const gltchModels = [
    { id: "gltch-edit", type: "image-edit", credits_per_unit: 5, description: "GLTCH image editing" },
    { id: "gltch-edit-hd", type: "image-edit", credits_per_unit: 7, description: "GLTCH HD image editing with upscale" },
  ];

  // ComfyUI / GLTCH PRO models
  const comfyAvailable = !!(process.env.RUNPOD_ENDPOINT_ID && process.env.RUNPOD_API_KEY);
  const comfyModels = comfyAvailable ? [
    { id: "comfy-klein", type: "image-edit", credits_per_unit: 3, description: "GLTCH PRO Flux Klein image editing (default workflow)" },
    { id: "comfy-txt2img", type: "image", credits_per_unit: 3, description: "GLTCH PRO text-to-image (Stable Diffusion / Flux)" },
    { id: "comfy-wan-video", type: "video", credits_per_unit: 15, description: "GLTCH PRO WAN image-to-video generation" },
  ] : [];

  // Available checkpoints (for txt2img)
  const checkpoints = (process.env.COMFYUI_MODELS || "").split(",").map(m => m.trim()).filter(Boolean);

  return res.status(200).json({
    engines: [
      ...(grokEnabled ? [{ id: "grok", name: "GROK", description: "xAI Grok image & video generation", models: grokModels }] : []),
      { id: "gltch", name: "GLTCH", description: "AI-powered image editing", models: gltchModels },
      ...(comfyAvailable ? [{ id: "gltch-pro", name: "GLTCH PRO", description: "Advanced ComfyUI pipelines", models: comfyModels, checkpoints }] : []),
    ],
  });
}
