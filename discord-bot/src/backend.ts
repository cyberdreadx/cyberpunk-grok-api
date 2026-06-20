import { config } from "./config.js";

/**
 * Client for the GltchRunner backend, authenticated as a linked web user (auth.ts).
 * Mirrors src/hooks/useGrokApi.ts `comfySubmitAndPollStandalone`:
 *   - backend reads the `workflow` key on POST /comfyui { action: "generate", ... }
 *   - submit returns { promptId, outputType, runpodEndpointId }
 *   - poll  { action: "poll", promptId, outputType, runpodEndpointId } → { status, image?, video? }
 */

async function api(path: string, body: unknown, token: string) {
  const r = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
  return json;
}

export interface GenResult { image?: string; video?: string; }

/** Submit a ComfyUI job and poll until done. */
export async function comfySubmitAndPoll(
  body: Record<string, unknown>,
  token: string,
  opts: { pollMs?: number; maxAttempts?: number } = {},
): Promise<GenResult> {
  const { pollMs = 4000, maxAttempts = 120 } = opts;
  const submit = await api("/comfyui", { action: "generate", ...body }, token);

  const promptId: string | undefined = submit.promptId;
  if (!promptId) {
    const direct = submit.video || submit.image || submit.url;
    if (direct) return submit.video ? { video: direct } : { image: direct };
    throw new Error("No promptId returned from generate");
  }
  const videoWorkflows = new Set(["wan-video", "longlook", "ltx-video", "ltx-animate"]);
  const outputType: string =
    submit.outputType || (videoWorkflows.has(body.workflow as string) ? "video" : "image");
  const runpodEndpointId: string | undefined = submit.runpodEndpointId;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((res) => setTimeout(res, pollMs));
    const poll = await api(
      "/comfyui",
      { action: "poll", promptId, outputType, ...(runpodEndpointId && { runpodEndpointId }) },
      token,
    );
    if (poll.status === "done") return { image: poll.image, video: poll.video };
    if (poll.status === "error") throw new Error(poll.error || "Generation failed");
  }
  throw new Error("Timed out waiting for generation");
}

/** GLTCH text-to-image (Z-Image). Returns the image URL. Charges the user's credits. */
export async function generateImage(
  prompt: string,
  token: string,
  opts: { width?: number; height?: number } = {},
): Promise<string> {
  const body: Record<string, unknown> = { workflow: "zimage", prompt };
  if (opts.width) body.width = opts.width;
  if (opts.height) body.height = opts.height;
  const r = await comfySubmitAndPoll(body, token, { pollMs: 2500, maxAttempts: 120 });
  const url = r.image || r.video;
  if (!url) throw new Error("No image returned");
  return url;
}

/** Return raw base64 (no data: prefix) from a data URI or a fetchable URL. */
async function urlToBase64(url: string): Promise<string> {
  const m = url.match(/^data:[\w/+.-]+;base64,(.+)$/s);
  if (m) return m[1];
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Couldn't fetch start frame (HTTP ${r.status})`);
  return Buffer.from(await r.arrayBuffer()).toString("base64");
}

/**
 * Animate with LTX-2.3 (native sound, included in the per-second price).
 *  - With a start image → `ltx-animate` (image-to-video).
 *  - Without one → `ltx-video` (LTX does native text-to-video, so no separate
 *    Z-Image start frame is needed like the old WAN flow).
 * Returns the video URL. Charges the user's credits.
 */
export async function generateVideo(
  prompt: string,
  token: string,
  opts: {
    startImageUrl?: string; width?: number; height?: number;
    frameCount?: number; audioMode?: "none" | "ambient"; useUpscale?: boolean;
  } = {},
): Promise<string> {
  // LTX needs spatial dims divisible by 32 (the backend re-clamps too).
  const round32 = (n: number) => Math.max(64, Math.round(n / 32) * 32);
  const width = round32(opts.width ?? 832);
  const height = round32(opts.height ?? 480);
  const frameCount = opts.frameCount ?? 81;
  // LTX bundles native audio; only disable it when the user turned sound off.
  const withAudio = opts.audioMode !== "none";

  const body: Record<string, unknown> = {
    workflow: opts.startImageUrl ? "ltx-animate" : "ltx-video",
    prompt,
    width,
    height,
    frameCount,
    frameRate: 24,
    ltxAudio: withAudio,
  };

  if (opts.startImageUrl) {
    body.imageBase64 = await urlToBase64(opts.startImageUrl);
    body.imageFilename = "ltx_input.png";
  }

  const r = await comfySubmitAndPoll(body, token, { pollMs: 5000, maxAttempts: 150 });
  const url = r.video || r.image;
  if (!url) throw new Error("No video returned");
  return url;
}
