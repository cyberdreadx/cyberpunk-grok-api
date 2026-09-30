#!/usr/bin/env node
/**
 * GLTCH Runner MCP server.
 *
 * Exposes the public developer API (api/v1/*) as MCP tools, so any MCP client
 * — Claude Desktop, Claude Code, Cursor — can generate and edit media on a
 * GLTCH Runner account.
 *
 * Every tool here spends real credits from the account that owns the key. That
 * is stated in each tool description rather than buried in this file, because
 * the description is the only part the model actually reads before calling.
 *
 * Auth is the same X-API-Key header the REST API uses. Keys start with
 * gltch_sk_ and are created in the app under Settings -> API Keys.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = (process.env.GLTCH_API_BASE || "https://grokrunner.gltch.app").replace(/\/+$/, "");
const API_KEY = process.env.GLTCH_API_KEY || "";

/*
 * Generation is slow by nature: the request holds open across the whole RunPod
 * round trip, and the endpoint itself allows up to 300s. Video gets the full
 * budget; images get less, so a wedged image job doesn't pin the client for
 * five minutes when it was never going to return.
 */
const TIMEOUT_IMAGE_MS = 180_000;
const TIMEOUT_VIDEO_MS = 300_000;

const KEY_HELP =
  "Set GLTCH_API_KEY to a key from the app (Settings -> API Keys). Keys begin with gltch_sk_.";

type Ok = { ok: true; data: Record<string, unknown> };
type Err = { ok: false; message: string };

/**
 * Turn an HTTP failure into something a model can act on rather than a bare
 * status code. The distinction that matters most is 402 vs 502: one means stop
 * and tell the user to buy credits, the other means the job died and the
 * credits already came back, so retrying is free and reasonable.
 */
function explain(status: number, body: Record<string, unknown>): string {
  const detail = typeof body?.error === "string" ? body.error : "";
  switch (status) {
    case 401:
      return `API key rejected. ${KEY_HELP}`;
    case 402:
      return detail || "Not enough credits on this account to run that job.";
    case 403:
      return detail || "The account holding this key has not verified its email address.";
    case 404:
      return detail || "Endpoint not found — check GLTCH_API_BASE.";
    case 429:
      return "Rate limited by the API. Wait a moment before retrying.";
    case 502:
    case 503:
    case 504:
      return `${detail || "Generation failed."} Credits for a failed job are refunded automatically, so retrying costs nothing extra.`;
    default:
      return detail || `Request failed with HTTP ${status}.`;
  }
}

async function call(
  path: string,
  init: { method: string; body?: string },
  timeoutMs: number,
): Promise<Ok | Err> {
  if (!API_KEY) return { ok: false, message: `No API key configured. ${KEY_HELP}` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      body: init.body,
      signal: controller.signal,
      headers: {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "gltch-runner-mcp/1.0.0",
      },
    });

    const text = await res.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { error: text.slice(0, 400) };
    }

    if (!res.ok) return { ok: false, message: explain(res.status, body) };
    return { ok: true, data: body };
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError") {
      return {
        ok: false,
        message: `Timed out after ${Math.round(timeoutMs / 1000)}s. The job may still finish on the server; check the library in the app before spending credits on a retry.`,
      };
    }
    return { ok: false, message: `Could not reach ${API_BASE}: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** MCP tool results are a content array; every tool here returns one text block. */
function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Render a generation response the same way whichever endpoint produced it. */
function renderResult(data: Record<string, unknown>): string {
  const url = (data.image_url || data.video_url) as string | undefined;
  const lines: string[] = [];
  if (url) lines.push(url);
  const bits: string[] = [];
  if (typeof data.workflow === "string") bits.push(`workflow ${data.workflow}`);
  if (data.seed !== undefined) bits.push(`seed ${data.seed}`);
  if (data.credits_used !== undefined) bits.push(`${data.credits_used} credits used`);
  if (data.credits_remaining !== undefined) bits.push(`${data.credits_remaining} remaining`);
  if (bits.length) lines.push(bits.join(" · "));
  return lines.join("\n") || JSON.stringify(data);
}

const server = new McpServer({ name: "gltch-runner", version: "1.0.0" });

// ── list_models ───────────────────────────────────────────────────────────

server.registerTool(
  "list_models",
  {
    title: "List models and prices",
    description:
      "List the engines available on GLTCH Runner, what each costs in credits, and which checkpoints and LoRAs the PRO engine can load. Free — reads only, spends nothing. Call this first when you are unsure which workflow or checkpoint name to pass to the other tools.",
    inputSchema: {},
  },
  async () => {
    const r = await call("/api/v1/models", { method: "GET" }, 30_000);
    if (!r.ok) return fail(r.message);
    return text(JSON.stringify(r.data, null, 2));
  },
);

// ── generate_image ────────────────────────────────────────────────────────

server.registerTool(
  "generate_image",
  {
    title: "Generate an image",
    description:
      "Generate an image on GLTCH Runner. SPENDS CREDITS from the account that owns the API key: 3 credits, or 4 for klein at HD. Pick the workflow by what you have: 'klein' edits or restyles an existing image and REQUIRES image_url; 'zimage' and 'txt2img' generate from a prompt alone, and txt2img additionally requires a checkpoint name from list_models. Returns a public URL to the finished image.",
    inputSchema: {
      prompt: z.string().min(1).describe("What to generate, in plain language."),
      workflow: z
        .enum(["klein", "zimage", "txt2img"])
        .default("zimage")
        .describe("klein needs image_url; zimage and txt2img do not; txt2img also needs checkpoint."),
      image_url: z.string().url().optional().describe("Public URL of the source image. Required for klein."),
      checkpoint: z.string().optional().describe("Checkpoint name, required for txt2img. See list_models."),
      negative_prompt: z.string().optional().describe("What to avoid. Ignored by Flux-based checkpoints."),
      width: z.number().int().min(256).max(2048).optional().describe("Default 832."),
      height: z.number().int().min(256).max(2048).optional().describe("Default 1216."),
      steps: z.number().int().min(1).max(100).optional().describe("Default 20. Higher is slower, not always better."),
      cfg: z.number().min(0.1).max(30).optional().describe("Prompt adherence. Default 7."),
      lora: z.string().optional().describe("Optional LoRA name from list_models."),
      lora_strength: z.number().min(0).max(2).optional().describe("Default 0.8."),
    },
  },
  async (args) => {
    if (args.workflow === "klein" && !args.image_url) {
      return fail("The klein workflow edits an existing image, so image_url is required. Use zimage to generate from a prompt alone.");
    }
    if (args.workflow === "txt2img" && !args.checkpoint) {
      return fail("txt2img needs a checkpoint name. Call list_models to see what is loadable.");
    }
    const r = await call("/api/v1/comfy", { method: "POST", body: JSON.stringify(args) }, TIMEOUT_IMAGE_MS);
    if (!r.ok) return fail(r.message);
    return text(renderResult(r.data));
  },
);

// ── edit_image ────────────────────────────────────────────────────────────

server.registerTool(
  "edit_image",
  {
    title: "Edit an image",
    description:
      "Edit an existing image with the GLTCH engine — restyle it, change or remove parts of it, follow an instruction about it. SPENDS CREDITS: 5, or 7 with hd. Needs a publicly reachable image_url. Returns a public URL to the edited image.",
    inputSchema: {
      prompt: z.string().min(1).describe("The edit to make, e.g. 'make it snow', 'remove the car'."),
      image_url: z.string().url().describe("Public URL of the image to edit."),
      aspect_ratio: z
        .enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"])
        .optional()
        .describe("Output shape. Default 1:1."),
      hd: z.boolean().optional().describe("HD upscale. Costs 7 credits instead of 5."),
    },
  },
  async (args) => {
    const r = await call("/api/v1/gltch", { method: "POST", body: JSON.stringify(args) }, TIMEOUT_IMAGE_MS);
    if (!r.ok) return fail(r.message);
    return text(renderResult(r.data));
  },
);

// ── generate_video ────────────────────────────────────────────────────────

server.registerTool(
  "generate_video",
  {
    title: "Generate a video",
    description:
      "Generate a short video on GLTCH Runner. SPENDS 15 CREDITS and takes minutes, not seconds. 'gltch-wan' animates an existing still and REQUIRES image_url — it is the engine the app itself uses. 'wan-video' also takes a source image. Returns a public URL to the finished video.",
    inputSchema: {
      prompt: z.string().min(1).describe("How the shot should move and what should happen in it."),
      image_url: z.string().url().describe("Public URL of the still to animate."),
      workflow: z.enum(["gltch-wan", "wan-video"]).default("gltch-wan").describe("gltch-wan is the app default."),
      frame_count: z
        .number()
        .int()
        .min(17)
        .max(241)
        .optional()
        .describe("Default 81. More frames is a longer clip and a longer wait."),
      resolution: z.number().int().min(480).max(1280).optional().describe("gltch-wan only. Default 832."),
      shift: z.number().min(1).max(15).optional().describe("gltch-wan only."),
      audio_mode: z.enum(["none", "ambient"]).optional().describe("gltch-wan only."),
      audio_prompt: z.string().optional().describe("gltch-wan only, used when audio_mode is ambient."),
      negative_prompt: z.string().optional(),
    },
  },
  async (args) => {
    const r = await call("/api/v1/comfy", { method: "POST", body: JSON.stringify(args) }, TIMEOUT_VIDEO_MS);
    if (!r.ok) return fail(r.message);
    return text(renderResult(r.data));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
