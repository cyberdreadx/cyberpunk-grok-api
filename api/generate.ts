/**
 * /api/generate — Proxy xAI requests for credit-mode users.
 * Verifies JWT, checks credits, forwards to xAI, deducts on success.
 *
 * MODERATION DEFENSE:
 * - xAI charges $0.05 per moderated image (2.5x normal) and $0.05/sec for video.
 * - If xAI blocks a request for guideline violations, we do NOT refund credits.
 * - Repeat offenders get a cooldown (blocked from generating).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL, checkBan } from "./_lib/auth";
import { checkRateLimit, getClientIp } from "./_lib/ratelimit";

const XAI_API_BASE = "https://api.x.ai/v1";

const CREDIT_COSTS = {
  imageGen: 4,
  imageEdit: 6,
  imageGenPro: 10,
  imageEditPro: 12,
  videoPerSecond: 6,
  seedanceVideoPerSecond: 2, // SEEDANCE 2.0 via fal.ai (~$0.036/s)
};

const FAL_BASE = "https://fal.run";

const PRO_MODEL = "grok-imagine-image-pro";

const ALLOWED_ACTIONS = ["generate-image", "edit-image", "generate-video", "edit-video"] as const;
type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

function calculateCost(action: AllowedAction, imageCount: number, videoDuration: number, isPro: boolean, is2k: boolean): number {
  switch (action) {
    case "generate-image":
      if (isPro && is2k) return CREDIT_COSTS.imageGenPro * 2 * imageCount;
      if (isPro) return CREDIT_COSTS.imageGenPro * imageCount;
      if (is2k) return CREDIT_COSTS.imageGen * 2 * imageCount;
      return CREDIT_COSTS.imageGen * imageCount;
    case "edit-image":
      if (isPro && is2k) return CREDIT_COSTS.imageEditPro * 2 * imageCount;
      if (isPro) return CREDIT_COSTS.imageEditPro * imageCount;
      if (is2k) return CREDIT_COSTS.imageEdit * 2 * imageCount;
      return CREDIT_COSTS.imageEdit * imageCount;
    case "generate-video":
    case "edit-video":
      return CREDIT_COSTS.videoPerSecond * videoDuration;
  }
}

/** Calculate actual xAI API cost in cents for a generation */
function calculateApiCostCents(action: AllowedAction, imageCount: number, videoDuration: number, isPro: boolean, is2k: boolean, moderated: boolean): number {
  if (moderated) {
    // xAI charges $0.05/image for moderated content
    if (action === "generate-image" || action === "edit-image") return 5 * imageCount * (is2k ? 2 : 1);
    return 5 * videoDuration; // video moderation
  }
  switch (action) {
    case "generate-image":
    case "edit-image": {
      // Standard: $0.02/image (2c), Pro: $0.07/image (7c), 2K doubles
      const perImage = isPro ? 7 : 2;
      return perImage * imageCount * (is2k ? 2 : 1);
    }
    case "generate-video":
    case "edit-video":
      return 5 * videoDuration; // $0.05/sec
  }
}

// ── Moderation Detection ──
// xAI returns errors containing these terms when content is blocked
const MODERATION_KEYWORDS = [
  "moderat",        // moderated, moderation
  "content_policy",
  "content policy",
  "safety",
  "blocked",
  "unsafe",
  "guideline",
  "inappropriate",
  "not allowed",
  "violat",         // violation, violates
  "prohibited",
  "restricted",
  "harmful",
  "explicit",
  "rejected",
];

function isModerationError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return MODERATION_KEYWORDS.some((kw) => lower.includes(kw));
}

// Map generation action → moderation log mode
function moderationMode(action: string): string {
  switch (action) {
    case "generate-image": return "moderation-image";
    case "edit-image": return "moderation-edit";
    case "generate-video": return "moderation-video";
    case "edit-video": return "moderation-video-edit";
    default: return "moderation-unknown";
  }
}

// Video generation can take minutes — increase timeout
// Body limit raised to 50 MB to accommodate large base64 image payloads (edits, multi-image)
export const config = {
  maxDuration: 300,
  api: { bodyParser: { sizeLimit: "50mb" } },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── CORS ──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // ── BYOK (Bring Your Own Key) mode ──────────────────────────────────────
    // If the client sends a byokKey, skip auth/credits entirely and proxy as-is.
    const byokKey = typeof req.body?.byokKey === "string" ? req.body.byokKey.trim() : null;
    if (byokKey) {
      const byokIp = getClientIp(req);
      const { allowed: byokAllowed } = await checkRateLimit(`byok:${byokIp}`, "generate", { max: 30, windowSeconds: 300 });
      if (!byokAllowed) {
        return res.status(429).json({ error: "Rate limit reached. Please wait before generating again." });
      }

      const { action, byokKey: _omit, ...params } = req.body || {};
      if (!action || !ALLOWED_ACTIONS.includes(action as AllowedAction)) {
        return res.status(400).json({ error: "Invalid action." });
      }

      // Validate prompt length
      if (params.prompt && typeof params.prompt === "string" && params.prompt.length > 10000) {
        return res.status(400).json({ error: "Prompt too long (max 10,000 characters)." });
      }

      let xaiEndpoint: string;
      switch (action as AllowedAction) {
        case "generate-image": xaiEndpoint = "/images/generations"; break;
        case "edit-image": xaiEndpoint = "/images/edits"; break;
        case "generate-video": xaiEndpoint = "/videos/generations"; break;
        case "edit-video": xaiEndpoint = "/videos/edits"; break;
        default: return res.status(400).json({ error: "Invalid action" });
      }

      // Transform video edit body
      const byokParams = { ...params };
      if (action === "edit-video" && byokParams.video_url && !byokParams.video) {
        byokParams.video = { url: byokParams.video_url };
        delete byokParams.video_url;
      }

      const byokResp = await fetch(`${XAI_API_BASE}${xaiEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${byokKey}` },
        body: JSON.stringify(byokParams),
      });

      if (!byokResp.ok) {
        const errText = await byokResp.text();
        let safeError = `Upstream error (${byokResp.status})`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error?.message) safeError = parsed.error.message;
          else if (typeof parsed.error === "string") safeError = parsed.error;
        } catch { /* non-JSON — use generic message */ }
        return res.status(byokResp.status).json({ error: safeError });
      }

      let byokData: any = await byokResp.json();

      // Video polling for BYOK
      if (action === "generate-video" || action === "edit-video") {
        const requestId = byokData.request_id || byokData.id;
        if (requestId) {
          for (let i = 0; i < 120; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            let pollRes: Response;
            try {
              pollRes = await fetch(`${XAI_API_BASE}/videos/${requestId}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${byokKey}` },
              });
            } catch { continue; }
            if (pollRes.status === 202) { await pollRes.text().catch(() => { }); continue; }
            if (!pollRes.ok) {
              const errText = await pollRes.text();
              return res.status(pollRes.status).json({ error: errText });
            }
            const pollData: any = await pollRes.json();
            const status = pollData.status || pollData.state;
            if (status === "failed" || status === "error") return res.status(500).json({ error: pollData.error?.message || "Video generation failed" });
            if (status === "expired") return res.status(500).json({ error: "Video generation request expired. Please try again." });
            const url = pollData.video?.url || pollData.video_url || pollData.url;
            if (status === "done" || status === "completed" || status === "succeeded" || url) { byokData = pollData; break; }
          }
        }
      }

      return res.status(200).json(byokData);
    }

    // ── Credit-based (authenticated) mode ────────────────────────────────────
    const XAI_API_KEY = process.env.XAI_API_KEY;
    if (!XAI_API_KEY) return res.status(500).json({ error: "Server API key not configured" });

    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const sql = getDb();

    // Check if user is banned
    const ban = await checkBan(sql, auth.userId);
    if (ban.banned) {
      return res.status(403).json({ error: "Your account has been suspended.", reason: ban.reason });
    }

    // Rate limit: 60 generate requests per user per 5 minutes
    const { allowed } = await checkRateLimit(auth.userId, "generate", { max: 60, windowSeconds: 300 });
    if (!allowed) {
      return res.status(429).json({ error: "Rate limit reached. Please wait a moment before generating again." });
    }


    // Tiered moderation cooldown — escalating penalties for repeat offenders.
    // Tier 1: 10 flags in 10 minutes → 10 min cooldown (burst protection)
    // Tier 2: 50 flags in 24 hours → 1 hour cooldown (daily abuser)
    // Tier 3: 200 flags in 30 days → 24 hour cooldown (chronic abuser)
    const [modShort] = await sql`
      SELECT COUNT(*)::int AS cnt FROM usage_log
      WHERE user_id = ${auth.userId}::uuid AND mode LIKE 'moderation-%'
        AND created_at > now() - interval '10 minutes'
    `;
    if (modShort.cnt >= 10) {
      return res.status(429).json({
        error: "Too many flagged requests. Cool down for 10 minutes, then try rephrasing your prompt.",
        moderated: true,
      });
    }

    const [modDaily] = await sql`
      SELECT COUNT(*)::int AS cnt FROM usage_log
      WHERE user_id = ${auth.userId}::uuid AND mode LIKE 'moderation-%'
        AND created_at > now() - interval '24 hours'
    `;
    if (modDaily.cnt >= 50) {
      return res.status(429).json({
        error: "You've been flagged too many times today. Access is paused for 1 hour. Adjust your prompts to avoid content policy violations.",
        moderated: true,
      });
    }

    const [modMonthly] = await sql`
      SELECT COUNT(*)::int AS cnt FROM usage_log
      WHERE user_id = ${auth.userId}::uuid AND mode LIKE 'moderation-%'
        AND created_at > now() - interval '30 days'
    `;
    if (modMonthly.cnt >= 200) {
      const [lastFlag] = await sql`
        SELECT created_at FROM usage_log
        WHERE user_id = ${auth.userId}::uuid AND mode LIKE 'moderation-%'
        ORDER BY created_at DESC LIMIT 1
      `;
      const lastFlagTime = lastFlag?.created_at ? new Date(lastFlag.created_at).getTime() : 0;
      const hoursSinceLastFlag = (Date.now() - lastFlagTime) / (1000 * 60 * 60);
      if (hoursSinceLastFlag < 24) {
        return res.status(429).json({
          error: "Your account has been repeatedly flagged for content policy violations. Generation is paused for 24 hours. Continued violations may result in permanent suspension.",
          moderated: true,
        });
      }
    }

    const { action, ...params } = req.body || {};

    // Validate action against whitelist
    if (!action || !ALLOWED_ACTIONS.includes(action as AllowedAction)) {
      return res.status(400).json({ error: "Invalid action. Expected: generate-image, edit-image, generate-video, or edit-video." });
    }

    // Validate and clamp numeric inputs
    const imageCount = Math.max(1, Math.min(10, Math.floor(Number(params.n) || 1)));
    const videoDuration = Math.max(1, Math.min(60, Math.floor(Number(params.duration) || 5)));
    // Sanitize prompt length (DB column accepts 500 chars max)
    if (params.prompt && typeof params.prompt === "string" && params.prompt.length > 10000) {
      return res.status(400).json({ error: "Prompt too long (max 10,000 characters)." });
    }

    // ── SEEDANCE 2.0 (fal.ai) provider branch ────────────────────────────────
    // Mirrors the Grok video flow but routes to ByteDance Seedance 2.0 via fal.ai.
    // Cheaper (~$0.036/s) → 2 cr/sec. Supports text-to-video and image-to-video.
    if (params.provider === "seedance" && (action === "generate-video" || action === "edit-video")) {
      const FAL_KEY = process.env.FAL_KEY;
      if (!FAL_KEY) return res.status(500).json({ error: "SEEDANCE not configured (missing FAL_KEY)." });

      const seedDuration = Math.max(3, Math.min(12, Math.floor(Number(params.duration) || 5)));
      const seedCost = CREDIT_COSTS.seedanceVideoPerSecond * seedDuration;
      const isAdminSeed = auth.email === ADMIN_EMAIL;
      const adminTestSeed = isAdminSeed && req.body.testCredits === true;

      // Credit gate
      if (!isAdminSeed || adminTestSeed) {
        const rows = await sql`
          SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}
        `;
        if (rows.length === 0) return res.status(404).json({ error: "User not found" });
        const totalCredits = (rows[0].daily_credits || 0) + (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
        if (totalCredits < seedCost) {
          return res.status(402).json({ error: "Insufficient credits. Please purchase more in the Credit Store." });
        }
      }

      // Deduct credits up front
      if (!isAdminSeed || adminTestSeed) {
        try {
          await sql`SELECT deduct_credits(${auth.userId}::uuid, ${seedCost})`;
        } catch (err: any) {
          console.error("[seedance] deduct failed:", err.message);
          return res.status(402).json({ error: "Failed to deduct credits" });
        }
      }

      const refundSeed = async () => {
        if (isAdminSeed && !adminTestSeed) return;
        try {
          await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${seedCost})`;
        } catch (e: any) { console.error("[seedance] refund failed:", e.message); }
      };

      // Determine endpoint: image-to-video if image provided, else text-to-video.
      const seedImageUrl: string | undefined =
        (typeof params.image_url === "string" && params.image_url) ||
        (params.image && typeof params.image === "object" && params.image.url) ||
        undefined;
      const isI2V = !!seedImageUrl;
      const seedEndpoint = isI2V
        ? "/bytedance/seedance/v1/lite/image-to-video"
        : "/bytedance/seedance/v1/lite/text-to-video";

      const seedBody: Record<string, unknown> = {
        prompt: params.prompt,
        duration: String(seedDuration),
        resolution: "720p",
      };
      if (isI2V) seedBody.image_url = seedImageUrl;
      else if (params.aspect_ratio) seedBody.aspect_ratio = params.aspect_ratio;

      try {
        const falRes = await fetch(`${FAL_BASE}${seedEndpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Key ${FAL_KEY}`,
          },
          body: JSON.stringify(seedBody),
        });

        if (!falRes.ok) {
          const errText = await falRes.text().catch(() => "");
          await refundSeed();
          console.error("[seedance] fal error", falRes.status, errText.slice(0, 300));
          if (falRes.status === 400 && /safety|moderat|nsfw|content/i.test(errText)) {
            return res.status(451).json({ error: "Prompt blocked by SEEDANCE safety filter. Credits refunded.", moderated: true });
          }
          return res.status(502).json({ error: "SEEDANCE generation failed. Credits refunded." });
        }

        const falData: any = await falRes.json();
        const videoUrl = falData?.video?.url || falData?.video_url || falData?.url;
        if (!videoUrl) {
          await refundSeed();
          return res.status(502).json({ error: "SEEDANCE returned no video URL. Credits refunded." });
        }

        // Log usage (api cost ~ $0.036/s → cents)
        const apiCostCents = Math.round(3.6 * seedDuration);
        await sql`
          INSERT INTO usage_log (user_id, mode, credits_used, prompt, api_cost_cents)
          VALUES (${auth.userId}::uuid, ${'seedance-' + (isI2V ? 'i2v' : 't2v')}, ${seedCost}, ${(params.prompt || "").slice(0, 500)}, ${apiCostCents})
        `;

        return res.status(200).json({
          video: { url: videoUrl },
          video_url: videoUrl,
          provider: "seedance",
          duration: seedDuration,
        });
      } catch (err: any) {
        await refundSeed();
        console.error("[seedance] exception", err.message);
        return res.status(500).json({ error: "SEEDANCE generation failed. Credits refunded." });
      }
    }


    const isPro = params.model === PRO_MODEL;
    const is2k = params.resolution === "2k";
    const cost = calculateCost(action as AllowedAction, imageCount, videoDuration, isPro, is2k);
    const isAdminUser = auth.email === ADMIN_EMAIL;
    const adminTestCredits = isAdminUser && req.body.testCredits === true;

    // Credit gate (admin is free unless testCredits)
    if (!isAdminUser || adminTestCredits) {
      const rows = await sql`
        SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}
      `;
      if (rows.length === 0) return res.status(404).json({ error: "User not found" });

      const totalCredits = (rows[0].daily_credits || 0) + (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
      if (totalCredits < cost) {
        return res.status(402).json({ error: "Insufficient credits. Please purchase more in the Credit Store." });
      }
    }

    // Map action to xAI endpoint
    let xaiEndpoint: string;
    switch (action) {
      case "generate-image": xaiEndpoint = "/images/generations"; break;
      case "edit-image": xaiEndpoint = "/images/edits"; break;
      case "generate-video": xaiEndpoint = "/videos/generations"; break;
      case "edit-video": xaiEndpoint = "/videos/edits"; break;
      default: return res.status(400).json({ error: "Invalid action" }); // unreachable — whitelist above
    }

    // Deduct credits BEFORE calling xAI (admin skips deduction unless testing)
    if (!isAdminUser || adminTestCredits) {
      try {
        await sql`SELECT deduct_credits(${auth.userId}::uuid, ${cost})`;
      } catch (err: any) {
        console.error("Failed to deduct credits:", err.message);
        return res.status(402).json({ error: "Failed to deduct credits" });
      }
    }

    // Helper to refund credits on LEGITIMATE xAI failure (NOT moderation)
    const refundCredits = async () => {
      if (isAdminUser && !adminTestCredits) return;
      try {
        await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`;
        console.log(`Refunded ${cost} credits to ${auth.userId}`);
      } catch (refundErr: any) {
        console.error("Failed to refund credits:", refundErr.message);
      }
    };

    // Helper to log a moderation block (credits NOT refunded)
    const logModerationBlock = async (errText: string) => {
      try {
        const modMode = moderationMode(action);
        const promptSnippet = (params.prompt || "").slice(0, 500);
        const modApiCost = calculateApiCostCents(action as AllowedAction, imageCount, videoDuration, isPro, is2k, true);
        await sql`
          INSERT INTO usage_log (user_id, mode, credits_used, prompt, api_cost_cents)
          VALUES (${auth.userId}::uuid, ${modMode}, ${cost}, ${promptSnippet}, ${modApiCost})
        `;
        console.warn(`[moderation-block] user=${auth.userId} mode=${modMode} cost=${cost} apiCost=${modApiCost}c err=${errText.slice(0, 200)}`);
      } catch (logErr: any) {
        console.error("Failed to log moderation block:", logErr.message);
      }
    };

    // Transform video edit body: REST API expects "video": {"url": "..."} not flat video_url
    const forwardParams = { ...params };
    if (action === "edit-video" && forwardParams.video_url && !forwardParams.video) {
      forwardParams.video = { url: forwardParams.video_url };
      delete forwardParams.video_url;
    }

    // Forward to xAI
    const xaiResponse = await fetch(`${XAI_API_BASE}${xaiEndpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify(forwardParams),
    });

    if (!xaiResponse.ok) {
      const errText = await xaiResponse.text();

      // Check if this was a moderation / content policy block
      if (isModerationError(errText)) {
        // Credits not refunded — xAI still charges us for moderated requests
        await logModerationBlock(errText);
        return res.status(451).json({
          error: "This prompt was flagged by xAI's content filter. Credits were used because xAI charges for moderated requests too. Try rephrasing your prompt.",
          moderated: true,
        });
      }

      // Legitimate API error → refund credits
      await refundCredits();

      // Translate xAI quota/billing errors so users don't confuse them with their own credits
      if (xaiResponse.status === 429 || /monthly.*limit|rate.*limit|quota.*exceeded/i.test(errText)) {
        return res.status(503).json({
          error: "The AI generation service is temporarily at capacity. Your credits were NOT deducted. Please try again in a few minutes.",
          retryable: true,
        });
      }
      if (xaiResponse.status === 402 || xaiResponse.status === 403 || /billing|balance|payment|insufficient/i.test(errText)) {
        return res.status(503).json({
          error: "The AI generation service is temporarily unavailable. Your credits were NOT deducted. Please try again shortly.",
          retryable: true,
        });
      }

      return res.status(xaiResponse.status).json({ error: errText });
    }

    let xaiData: any = await xaiResponse.json();

    // For video: poll until complete
    if (action === "generate-video" || action === "edit-video") {
      const requestId = xaiData.request_id || xaiData.id;
      if (requestId) {
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          let pollRes: Response;
          try {
            pollRes = await fetch(`${XAI_API_BASE}/videos/${requestId}`, {
              method: "GET",
              headers: { Authorization: `Bearer ${XAI_API_KEY}` },
            });
          } catch {
            continue;
          }

          if (pollRes.status === 202) {
            await pollRes.text().catch(() => { });
            continue;
          }

          if (!pollRes.ok) {
            const errText = await pollRes.text();
            // Check moderation on polling failure too
            if (isModerationError(errText)) {
              await logModerationBlock(errText);
              return res.status(451).json({
                error: "This video was flagged by xAI's content filter. Credits were used because xAI charges for moderated requests. Try a different prompt.",
                moderated: true,
              });
            }
            await refundCredits();
            return res.status(pollRes.status).json({ error: errText });
          }

          const pollData: any = await pollRes.json();
          const status = pollData.status || pollData.state;

          if (status === "failed" || status === "error") {
            const failMsg = pollData.error?.message || "Video generation failed";
            // Check moderation on video failure
            if (isModerationError(failMsg)) {
              await logModerationBlock(failMsg);
              return res.status(451).json({
                error: "This video was flagged by xAI's content filter. Credits were used because xAI charges for moderated requests. Try a different prompt.",
                moderated: true,
              });
            }
            await refundCredits();
            return res.status(500).json({ error: failMsg });
          }

          if (status === "expired") {
            await refundCredits();
            return res.status(500).json({ error: "Video generation request expired. Please try again." });
          }

          const url = pollData.video?.url || pollData.video_url || pollData.url;
          if (status === "done" || status === "completed" || status === "succeeded" || url) {
            xaiData = pollData;
            break;
          }
        }
      }
    }

    // Log successful usage with actual API cost
    const apiCostCents = calculateApiCostCents(action as AllowedAction, imageCount, videoDuration, isPro, is2k, false);
    await sql`
      INSERT INTO usage_log (user_id, mode, credits_used, prompt, api_cost_cents)
      VALUES (${auth.userId}::uuid, ${action}, ${cost}, ${(params.prompt || "").slice(0, 500)}, ${apiCostCents})
    `;

    return res.status(200).json(xaiData);
  } catch (err: any) {
    console.error("[generate]", err.message);
    return res.status(500).json({ error: "Generation failed. Please try again." });
  }
}
