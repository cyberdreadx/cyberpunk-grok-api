/**
 * RunPod Serverless submit & poll helpers.
 */

import { config } from "../config.js";

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

async function runpodRequest(
  endpointId: string,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: any,
) {
  const url = `${RUNPOD_API_BASE}/${endpointId}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${config.runpodApiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RunPod ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

export interface SubmitResult {
  jobId: string;
  endpointId: string;
}

export async function submitWorkflow(
  endpointId: string,
  workflow: Record<string, any>,
  images?: Record<string, string>,
): Promise<SubmitResult> {
  const payload: any = { input: { workflow } };
  if (images && Object.keys(images).length > 0) {
    payload.input.images = images.map
      ? images
      : Object.entries(images).map(([name, data]) => ({ name, image: data }));

    if (!Array.isArray(payload.input.images)) {
      payload.input.images = Object.entries(images).map(([name, data]) => ({
        name,
        image: data,
      }));
    }
  }

  const result = await runpodRequest(endpointId, "/run", "POST", payload);
  if (!result?.id) throw new Error("RunPod did not return a job ID");

  return { jobId: result.id, endpointId };
}

export type JobStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export interface PollResult {
  status: JobStatus;
  output?: {
    images?: Array<{ url?: string; image?: string }>;
    status?: string;
  };
  error?: string;
}

export async function pollJob(endpointId: string, jobId: string): Promise<PollResult> {
  const result = await runpodRequest(endpointId, `/status/${jobId}`);
  return {
    status: result.status as JobStatus,
    output: result.output,
    error: result.error,
  };
}

export function resolveOutputUrl(output: PollResult["output"]): string | null {
  if (!output?.images || output.images.length === 0) return null;

  for (const img of output.images) {
    if (img.url) return img.url;
    if (img.image) {
      if (img.image.startsWith("http")) return img.image;
      if (img.image.startsWith("data:")) return img.image;
    }
  }
  return null;
}

export async function downloadOutput(urlOrDataUri: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (urlOrDataUri.startsWith("data:")) {
    const match = urlOrDataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data URI");
    return {
      buffer: Buffer.from(match[2], "base64"),
      mimeType: match[1],
    };
  }

  const res = await fetch(urlOrDataUri, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "application/octet-stream";
  return { buffer: buf, mimeType };
}
