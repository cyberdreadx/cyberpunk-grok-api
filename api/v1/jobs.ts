/**
 * /api/v1/jobs — asynchronous generation for the public API.
 *
 * Why this exists: /api/v1/comfy holds one HTTP connection open for the whole
 * generation and gives up at 280 seconds, refunding. That is comfortable for
 * images, which land in 10-80s, and unusable for video — a measured gltch-wan
 * job was refunded at 282s having never actually failed. The app has always
 * managed video because it polls out of band. This gives the API the same
 * option: submit returns a handle immediately, and the caller polls it.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key. Same keys, same prices,
 * same engines as the synchronous endpoint — the request handling is literally
 * the same code, in ./_lib/comfy-job.
 *
 *   POST /api/v1/jobs
 *     Body is identical to /api/v1/comfy. Credits are taken now, so queued
 *     work is never free, and returned in full if the job fails or expires.
 *     -> 202 { job_id, status: "running", poll_url, credits_held, ... }
 *
 *   GET /api/v1/jobs?id=<job_id>
 *     -> 200 { status: "running",   elapsed_seconds, ... }
 *     -> 200 { status: "completed", video_url | image_url, seed, credits_used }
 *     -> 200 { status: "failed",    error, credits_refunded }
 *
 *   GET /api/v1/jobs
 *     -> 200 { jobs: [...] }   the 20 most recent for this account
 *
 * Polling is free and not rate-limited as generation; only POST spends.
 */

import { hasLoraAccess, isAdultLora, LORA_LOCKED_MESSAGE } from "../_lib/adult-loras";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";
import {
  isEmailVerified,
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  EMAIL_VERIFICATION_REQUIRED_CODE,
} from "../_lib/emailVerifiedGate";
import {
  deductCredits,
  refundCredits,
  getUserCredits,
  discountedCostForUser,
} from "./_lib/credits";
import {
  COMFY_COSTS,
  VALID_WORKFLOWS,
  isVideoWorkflow,
  workflowNeedsImage,
  resolveEndpoint,
  buildComfyGraph,
  fetchSourceImage,
  submitToRunPod,
} from "./_lib/comfy-job";
import { advanceJob, renderJob, type JobRow } from "./_lib/job-runner";

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
  // Submit only fetches the source image and hands the graph to RunPod, so it
  // no longer needs the 300s the synchronous endpoint does.
  maxDuration: 120,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "POST to submit, GET to poll" });
  }

  try {
    const auth = await getUserFromApiKey(req);
    if (!auth) return res.status(401).json({ error: "Invalid or missing API key." });

    if (!(await isEmailVerified(auth.userId))) {
      return res.status(403).json({
        error: EMAIL_VERIFICATION_REQUIRED_MESSAGE,
        code: EMAIL_VERIFICATION_REQUIRED_CODE,
      });
    }

    // Adult LoRAs need the paid LoRA unlock, same as in the app (_lib/adult-loras).
    if (isAdultLora((req.body || {}).lora) && !(await hasLoraAccess(auth.userId))) {
      return res.status(403).json({ error: LORA_LOCKED_MESSAGE, code: "LORA_LOCKED" });
    }

    const sql = getDb();

    // ── GET: poll one job, or list recent ones ──────────────────────────
    if (req.method === "GET") {
      const id = (req.query?.id as string) || "";
      if (!id) {
        const rows = (await sql`
          SELECT * FROM api_jobs WHERE user_id = ${auth.userId}::uuid
          ORDER BY created_at DESC LIMIT 20
        `) as JobRow[];
        return res.status(200).json({ jobs: rows.map(renderJob) });
      }
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ error: "id must be a job_id returned by POST /api/v1/jobs" });
      }
      // Scoped to the caller: a job id is not a capability for someone else's.
      const [job] = (await sql`
        SELECT * FROM api_jobs
        WHERE id = ${id}::uuid AND user_id = ${auth.userId}::uuid
      `) as JobRow[];
      if (!job) return res.status(404).json({ error: "No such job for this account." });

      const advanced = await advanceJob(sql, job);
      return res.status(200).json(renderJob(advanced));
    }

    // ── POST: submit ────────────────────────────────────────────────────
    const { allowed } = await checkRateLimit(
      `apikey:${auth.apiKeyId}`, "v1-jobs",
      { max: auth.rateLimit, windowSeconds: 60 },
    );
    if (!allowed) return res.status(429).json({ error: "Rate limit exceeded." });

    const body = req.body || {};
    const prompt = ((body.prompt as string) || "").trim();
    if (!prompt || prompt.length > 5000) {
      return res.status(400).json({ error: "prompt is required (max 5000 chars)" });
    }

    const workflow = ((body.workflow as string) || "klein").toLowerCase();
    if (!VALID_WORKFLOWS.includes(workflow)) {
      return res.status(400).json({ error: `workflow must be one of: ${VALID_WORKFLOWS.join(", ")}` });
    }

    const needsImage = workflowNeedsImage(workflow);
    const imageUrl = ((body.image_url as string) || "").trim();
    if (needsImage && !imageUrl) {
      return res.status(400).json({ error: `image_url is required for the ${workflow} workflow` });
    }

    if (workflow === "txt2img" && !body.checkpoint) {
      const checkpoints = (process.env.COMFYUI_MODELS || "")
        .split(",").map((m) => m.trim()).filter(Boolean);
      if (checkpoints.length === 0) {
        return res.status(400).json({ error: "checkpoint is required for txt2img" });
      }
      body.checkpoint = checkpoints[0];
    }

    const endpoint = resolveEndpoint(workflow);
    if (!endpoint || !process.env.RUNPOD_API_KEY) {
      return res.status(503).json({ error: "GLTCH PRO service not configured" });
    }

    const [user] = await sql`
      SELECT daily_credits, sub_credits, pack_credits,
             COALESCE(subscription_discount_pct, 0) AS subscription_discount_pct
      FROM users WHERE id = ${auth.userId}
    `;
    if (!user) return res.status(404).json({ error: "User not found" });

    const available = getUserCredits(user);
    const cost = await discountedCostForUser(auth.userId, COMFY_COSTS[workflow] ?? 3);
    if (available < cost) {
      return res.status(402).json({ error: "Insufficient credits", required: cost, available });
    }

    // Everything that can be rejected for free has been rejected. Charge now,
    // then refund on any failure below — the same order the synchronous
    // endpoint uses, so a caller cannot get queued work without paying for it.
    const split = await deductCredits(sql, auth.userId, cost, user);

    const steps = Math.min(100, Math.max(1, Number(body.steps) || 20));
    const cfg = Math.min(30, Math.max(0.1, Number(body.cfg) || 7));
    const seed = Math.floor(Math.random() * 2 ** 32);
    const imageFilename = `api_input_${Date.now()}.jpg`;

    let imageBase64: string | undefined;
    if (needsImage) {
      const img = await fetchSourceImage(imageUrl);
      if (!img.ok) {
        await refundCredits(sql, auth.userId, split);
        // strictNullChecks is off project-wide, so `!img.ok` does not narrow the union.
        return res.status(400).json({ error: (img as { ok: false; message: string }).message });
      }
      imageBase64 = img.base64;
    }

    const graph = buildComfyGraph({ workflow, prompt, body, imageFilename, seed, steps, cfg });
    const submitted = await submitToRunPod(endpoint, graph, imageBase64, imageFilename);
    if (!submitted.ok) {
      await refundCredits(sql, auth.userId, split);
      return res.status(502).json({ error: `${(submitted as { ok: false; message: string }).message} Credits refunded.` });
    }

    const kind = isVideoWorkflow(workflow) ? "video" : "image";
    const [job] = (await sql`
      INSERT INTO api_jobs (
        user_id, api_key_id, workflow, kind, params,
        rp_endpoint, rp_job_id, credits_held, credits_split, seed
      ) VALUES (
        ${auth.userId}::uuid, ${auth.apiKeyId}::uuid, ${workflow}, ${kind},
        ${JSON.stringify({ prompt, steps, cfg, image_url: imageUrl || null })}::jsonb,
        ${endpoint}, ${submitted.rpJobId}, ${cost},
        ${JSON.stringify(split)}::jsonb, ${seed}
      )
      RETURNING *
    `) as JobRow[];

    console.log(`[v1/jobs] ${job.id} submitted (${workflow}, ${cost} credits, rp ${submitted.rpJobId})`);

    return res.status(202).json({
      ...renderJob(job),
      poll_url: `/api/v1/jobs?id=${job.id}`,
      credits_remaining: available - cost,
      message: kind === "video"
        ? "Video queued. Poll every 10-15s; these usually take 3-8 minutes."
        : "Queued. Poll every 3-5s.",
    });
  } catch (err: any) {
    console.error("[v1/jobs] error:", err?.message);
    return res.status(500).json({ error: "Internal error" });
  }
}
