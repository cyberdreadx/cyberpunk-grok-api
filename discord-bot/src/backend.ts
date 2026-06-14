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
  const outputType: string =
    submit.outputType || (body.workflow === "wan-video" || body.workflow === "longlook" ? "video" : "image");
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
export async function generateImage(prompt: string, token: string): Promise<string> {
  const r = await comfySubmitAndPoll({ workflow: "zimage", prompt }, token, { pollMs: 2500, maxAttempts: 120 });
  const url = r.image || r.video;
  if (!url) throw new Error("No image returned");
  return url;
}

/** Fetch a remote image and return raw base64 (no data: prefix). */
async function urlToBase64(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Couldn't fetch start frame (HTTP ${r.status})`);
  return Buffer.from(await r.arrayBuffer()).toString("base64");
}

/**
 * Animate (WAN 2.2 video). With a start image → image-to-video. Without one →
 * generate a free Z-Image start frame from the prompt (skipCredits, like the web
 * "render" flow where the wan-video step pays), then animate it. Returns video URL.
 */
export async function generateVideo(prompt: string, token: string, startImageUrl?: string): Promise<string> {
  let imageBase64: string;
  if (startImageUrl) {
    imageBase64 = await urlToBase64(startImageUrl);
  } else {
    const frame = await comfySubmitAndPoll(
      { workflow: "zimage", prompt, skipCredits: true },
      token,
      { pollMs: 2500, maxAttempts: 120 },
    );
    if (!frame.image) throw new Error("Couldn't generate a start frame");
    imageBase64 = await urlToBase64(frame.image);
  }

  const r = await comfySubmitAndPoll(
    {
      workflow: "wan-video",
      prompt,
      imageBase64,
      imageFilename: "input.jpg",
      width: 832,
      height: 480,
      frameCount: 81,
      steps: 8,
      cfg: 1,
      useRife: true,
      useUpscale: false,
    },
    token,
    { pollMs: 5000, maxAttempts: 120 },
  );
  const url = r.video || r.image;
  if (!url) throw new Error("No video returned");
  return url;
}
