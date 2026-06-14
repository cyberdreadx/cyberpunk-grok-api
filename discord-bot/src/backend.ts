import { config } from "./config.js";

/**
 * Thin client for the GltchRunner backend, authenticated as a linked web user
 * via a minted JWT (see auth.ts). This mirrors what the web app does in
 * src/hooks/useGrokApi.ts — submit a job, then poll until the media is ready.
 *
 * NOTE: the request bodies below target /api/comfyui (GLTCH engine). If the web
 * app's contract changes, mirror it here — this is the single integration point.
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

export interface GenResult { url: string; type: "image" | "video"; }

/** Submit a GLTCH image generation and poll until done. Returns the media URL. */
export async function generateImage(prompt: string, token: string): Promise<GenResult> {
  // Z-Image (GLTCH) text-to-image — cheap, no checkpoint required. Adjust to match
  // the web app's current generate request if needed.
  const submit = await api("/comfyui", {
    action: "generate",
    workflowType: "zimage",
    prompt,
  }, token);

  const jobId: string | undefined = submit.jobId || submit.id;
  if (!jobId) {
    // Some paths return the media synchronously.
    const url = submit.image || submit.video || submit.url;
    if (url) return { url, type: submit.video ? "video" : "image" };
    throw new Error("No jobId or media returned from generate");
  }

  const deadline = Date.now() + 5 * 60_000; // 5 min
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 3000));
    const poll = await api("/comfyui", { action: "poll", jobId }, token);
    if (poll.status === "done" || poll.status === "completed") {
      const url = poll.video || poll.image || poll.url;
      if (!url) throw new Error("Job done but no media URL");
      return { url, type: poll.video ? "video" : "image" };
    }
    if (poll.status === "failed" || poll.error) {
      throw new Error(poll.error || "Generation failed");
    }
  }
  throw new Error("Timed out waiting for generation");
}
