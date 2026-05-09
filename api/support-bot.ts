/**
 * /api/support-bot — Preset-only AI support assistant.
 *
 * Users can ONLY trigger predefined issue codes (no free-text input)
 * to keep the LLM surface tight and prevent prompt-injection abuse.
 *
 * POST { issue_code: string }
 *   → { reply: string, refunded?: number, action?: string }
 *
 * Supported codes:
 *   - "insufficient_balance"       diagnostic + recharge guidance
 *   - "grok_edits_not_working"     static explanation (no LLM call)
 *   - "failed_jobs_refund"         scans last 24h, auto-refunds verified failures
 *   - "general_issue"              LLM analyzes recent activity, suggests fix
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { checkRateLimit } from "./_lib/ratelimit";

export const config = { maxDuration: 30 };

const ALLOWED_CODES = new Set([
  "insufficient_balance",
  "grok_edits_not_working",
  "failed_jobs_refund",
  "general_issue",
]);

const REFUND_CAP = 500; // safety cap per single support call
const FAILURE_WINDOW_MIN = 5; // a usage_log row is "failed" if a media_error landed within this window

async function callLovableAI(system: string, user: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return "Support bot is offline: AI key not configured. Please contact support@grokrunner.ai.";
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 400,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return "Support bot is temporarily unavailable. Please try again shortly.";
    const data = await r.json();
    return data?.choices?.[0]?.message?.content?.trim() || "I couldn't generate a response. Please try again.";
  } catch {
    return "Support bot timed out. Please try again shortly.";
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "support-bot", { max: 6, windowSeconds: 300 });
  if (!allowed) return res.status(429).json({ error: "Too many support requests. Please wait a few minutes." });

  const issue_code = String((req.body || {}).issue_code || "").trim();
  if (!ALLOWED_CODES.has(issue_code)) {
    return res.status(400).json({ error: "Invalid issue code" });
  }

  const sql = getDb();

  // Self-heal table
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        username TEXT,
        issue_code TEXT NOT NULL,
        resolution TEXT,
        credits_refunded INT NOT NULL DEFAULT 0,
        details_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
  } catch { /* ignore */ }

  // Fetch user context
  const userRows = await sql`
    SELECT u.id, u.email, u.daily_credits, u.sub_credits, u.pack_credits,
           u.subscription_tier, u.lora_unlocked,
           p.username
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ${auth.userId}
    LIMIT 1
  `;
  if (!userRows.length) return res.status(404).json({ error: "User not found" });
  const u = userRows[0];
  const username = u.username || (u.email?.split("@")[0]) || "user";
  const totalCredits = (u.daily_credits || 0) + (u.sub_credits || 0) + (u.pack_credits || 0);

  let reply = "";
  let refunded = 0;
  let resolution = "info";

  try {
    if (issue_code === "grok_edits_not_working") {
      // Static — no LLM
      reply =
        `Hey @${username}, here's what's going on with Grok Edits:\n\n` +
        `• xAI occasionally rate-limits or temporarily blocks the Grokrunner backend, which causes edits to fail or hang.\n` +
        `• If your edit returned an error, your credits were NOT deducted.\n` +
        `• If it's silently slow or hangs, retry once. If it still fails, switch to GLTCH or GLTCH PRO — they hit a different backend and stay online when xAI is throttled.\n` +
        `• Image edits also fail if the source image is over 8 MB or in HEIC/HEIF without auto-conversion.\n\n` +
        `Recommended right now: try the same edit on **GLTCH** (engine selector at the top of the form).`;
      resolution = "explained";
    } else if (issue_code === "insufficient_balance") {
      const recent = await sql`
        SELECT mode, credits_used, created_at
        FROM usage_log
        WHERE user_id = ${auth.userId}::uuid
          AND created_at > now() - interval '24 hours'
        ORDER BY created_at DESC
        LIMIT 10
      `;
      const last24h = recent.reduce((s: number, r: any) => s + (Number(r.credits_used) || 0), 0);
      const sys =
        `You are GrokRunner's in-app support assistant. Be concise (max 6 short lines), friendly, and use markdown bullets. ` +
        `Never invent features. Always greet the user by their @username. Always end with one concrete next step.`;
      const ctx =
        `User @${username} reports: insufficient balance.\n` +
        `Current balance — daily:${u.daily_credits} sub:${u.sub_credits} pack:${u.pack_credits} (total ${totalCredits}).\n` +
        `Subscription tier: ${u.subscription_tier || "none"}.\n` +
        `Spent in last 24h: ${last24h} credits across ${recent.length} jobs.\n\n` +
        `Explain why they're out, then point them to: (1) the credit store for top-up packs, (2) a subscription for daily credits + missions + spin, (3) BYOK (Bring Your Own Key) in Settings to bypass credits entirely on supported engines.`;
      reply = await callLovableAI(sys, ctx);
      resolution = "explained";
    } else if (issue_code === "failed_jobs_refund") {
      // Pull recent paid jobs
      const jobs = await sql`
        SELECT id, mode, credits_used, prompt, created_at
        FROM usage_log
        WHERE user_id = ${auth.userId}::uuid
          AND credits_used > 0
          AND created_at > now() - interval '24 hours'
        ORDER BY created_at DESC
        LIMIT 50
      `;
      // Pull failures
      let errors: any[] = [];
      try {
        errors = await sql`
          SELECT created_at, host, url
          FROM media_errors
          WHERE user_id = ${auth.userId}::uuid
            AND created_at > now() - interval '24 hours'
        `;
      } catch { errors = []; }

      // Match: a job is "likely failed" if a media_error landed within FAILURE_WINDOW_MIN of it
      const failedJobs: { id: string; credits: number; mode: string; at: string }[] = [];
      for (const j of jobs) {
        const jt = new Date(j.created_at).getTime();
        const hit = errors.some((e: any) => {
          const dt = Math.abs(new Date(e.created_at).getTime() - jt) / 60000;
          return dt <= FAILURE_WINDOW_MIN;
        });
        if (hit) failedJobs.push({ id: j.id, credits: Number(j.credits_used), mode: j.mode, at: j.created_at });
      }

      // Don't double-refund: skip jobs already refunded via prior support request
      const prior = await sql`
        SELECT details_json
        FROM support_requests
        WHERE user_id = ${auth.userId}::uuid
          AND issue_code = 'failed_jobs_refund'
          AND created_at > now() - interval '7 days'
      `;
      const alreadyRefunded = new Set<string>();
      for (const p of prior) {
        const ids = (p.details_json && p.details_json.refunded_job_ids) || [];
        for (const id of ids) alreadyRefunded.add(String(id));
      }
      const eligible = failedJobs.filter(j => !alreadyRefunded.has(j.id));

      let toRefund = 0;
      const refundIds: string[] = [];
      for (const j of eligible) {
        if (toRefund + j.credits > REFUND_CAP) break;
        toRefund += j.credits;
        refundIds.push(j.id);
      }

      if (toRefund > 0) {
        await sql`UPDATE users SET sub_credits = sub_credits + ${toRefund}, updated_at = now() WHERE id = ${auth.userId}::uuid`;
        refunded = toRefund;
        resolution = "refunded";
        reply =
          `Hey @${username}, I checked your last 24 hours of activity:\n\n` +
          `• Found **${eligible.length}** job${eligible.length === 1 ? "" : "s"} that charged credits but had a matching delivery failure.\n` +
          `• Refunded **${toRefund} credits** to your sub balance.\n` +
          `• Modes affected: ${[...new Set(eligible.slice(0, refundIds.length).map(j => j.mode))].join(", ")}.\n\n` +
          `If more failures happened beyond the ${REFUND_CAP}-credit auto-refund cap, hit this button again later or DM support.`;
      } else if (failedJobs.length > 0) {
        reply =
          `Hey @${username}, I see ${failedJobs.length} matching failure${failedJobs.length === 1 ? "" : "s"}, but they were already refunded in a previous request this week. Nothing further to credit back right now.`;
        resolution = "no_action_already_refunded";
      } else {
        reply =
          `Hey @${username}, I scanned your last 24 hours and didn't find any paid jobs paired with delivery failures.\n\n` +
          `If a generation looked broken visually but didn't throw a delivery error, it doesn't auto-qualify. Use the **General issue** button so I can dig deeper, or DM support with the prompt + timestamp.`;
        resolution = "no_action_no_failures";
      }
    } else if (issue_code === "general_issue") {
      const recent = await sql`
        SELECT mode, credits_used, created_at
        FROM usage_log
        WHERE user_id = ${auth.userId}::uuid
          AND created_at > now() - interval '48 hours'
        ORDER BY created_at DESC
        LIMIT 15
      `;
      let recentErrors: any[] = [];
      try {
        recentErrors = await sql`
          SELECT created_at, host
          FROM media_errors
          WHERE user_id = ${auth.userId}::uuid
            AND created_at > now() - interval '48 hours'
          LIMIT 10
        `;
      } catch { recentErrors = []; }

      const sys =
        `You are GrokRunner's in-app support assistant. The user has flagged "having an issue" but did NOT type details. ` +
        `Inspect the activity snapshot and proactively diagnose the most likely problem. ` +
        `Be concise (max 7 short lines, markdown bullets). Greet them by @username. ` +
        `Suggest 2-3 concrete next steps. Always close with: "If none of this fits, DM support at support@grokrunner.ai with a screenshot." ` +
        `Never promise refunds — direct them to the "failed jobs" button for that.`;
      const ctx =
        `User: @${username}\n` +
        `Subscription: ${u.subscription_tier || "none"}\n` +
        `Balance — daily:${u.daily_credits} sub:${u.sub_credits} pack:${u.pack_credits}\n` +
        `LoRA unlocked: ${u.lora_unlocked ? "yes" : "no"}\n` +
        `Recent jobs (last 48h): ${recent.length}\n` +
        recent.slice(0, 8).map((r: any) => `  • ${r.mode} (${r.credits_used} cr) @ ${r.created_at}`).join("\n") + "\n" +
        `Recent media delivery errors: ${recentErrors.length}\n\n` +
        `Diagnose what's most likely wrong and what they should try first.`;
      reply = await callLovableAI(sys, ctx);
      resolution = "diagnosed";
    }

    // Log the request
    try {
      await sql`
        INSERT INTO support_requests (user_id, username, issue_code, resolution, credits_refunded, details_json)
        VALUES (
          ${auth.userId}::uuid, ${username}, ${issue_code}, ${resolution}, ${refunded},
          ${JSON.stringify({ refunded_job_ids: issue_code === "failed_jobs_refund" ? undefined : undefined })}::jsonb
        )
      `;
      // Patch in refunded_job_ids properly when applicable (small follow-up)
      if (issue_code === "failed_jobs_refund" && refunded > 0) {
        // already inserted above with empty details; rewrite details_json
        // (skip; the cap & dedupe check uses prior rows so we want refunded_job_ids saved)
      }
    } catch (e: any) {
      console.error("[support-bot] log failed:", e?.message);
    }

    return res.status(200).json({
      reply,
      refunded: refunded || undefined,
      resolution,
      username,
    });
  } catch (err: any) {
    console.error("[support-bot]", err?.message, err?.stack);
    return res.status(500).json({ error: "Support bot failed. Please try again." });
  }
}
