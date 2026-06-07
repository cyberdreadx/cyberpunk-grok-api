/**
 * Character companion chat — LLM round-trip + billing for fan ↔ public persona.
 * Called from api/chat.ts when body has action "message" + characterId.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ADMIN_EMAIL, checkBan } from "./auth";
import { getDb } from "./db";
import { checkRateLimit } from "./ratelimit";
import { deductCredits, discountedCostForUser } from "../v1/_lib/credits";

const BASE_COST = 1;
const FREE_PER_DAY = 3;

// ── Creator monetization (Phase 1) ──
// Media always costs (creator price in credits) ON TOP of the compute the client
// pays via /comfyui. Text is free for FREE_PER_DAY/day, then BASE_COST.
// These defaults become per-creator (programmable menu) in Phase 2.
const PHOTO_PRICE = 8;
const VIDEO_PRICE = 25;
const CREATOR_SHARE = 0.75;          // 75% creator / 20% platform / 5% charity
const RETAIL_CENTS_PER_CREDIT = 8;   // ~PRO pack ($0.079/credit) → creator cash value

const MEDIA_IMAGE_RE = /\[MEDIA_IMAGE\]([\s\S]*?)\[\/MEDIA_IMAGE\]/i;
const MEDIA_VIDEO_RE = /\[MEDIA_VIDEO\]([\s\S]*?)\[\/MEDIA_VIDEO\]/i;

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function stripMediaTags(text: string): string {
  return text
    .replace(/\[MEDIA_IMAGE\][\s\S]*?\[\/MEDIA_IMAGE\]/gi, "")
    .replace(/\[MEDIA_VIDEO\][\s\S]*?\[\/MEDIA_VIDEO\]/gi, "")
    .trim();
}

function extractMediaTrigger(reply: string): {
  reply: string;
  mediaTrigger?: { type: "image" | "video"; prompt: string };
} {
  let mediaTrigger: { type: "image" | "video"; prompt: string } | undefined;
  const vid = reply.match(MEDIA_VIDEO_RE);
  const img = reply.match(MEDIA_IMAGE_RE);
  if (vid?.[1]?.trim()) mediaTrigger = { type: "video", prompt: vid[1].trim().slice(0, 500) };
  else if (img?.[1]?.trim()) mediaTrigger = { type: "image", prompt: img[1].trim().slice(0, 500) };
  return { reply: stripMediaTags(reply) || reply.trim(), mediaTrigger };
}

interface JwtAuth {
  userId: string;
  email: string;
}

export async function handleCharacterChatMessage(
  req: VercelRequest,
  res: VercelResponse,
  auth: JwtAuth,
  sql: ReturnType<typeof getDb>,
): Promise<void> {
  const { allowed } = await checkRateLimit(auth.userId, "character-chat-msg", { max: 45, windowSeconds: 60 });
  if (!allowed) {
    res.status(429).json({ error: "Slow down — too many character messages." });
    return;
  }

  const ban = await checkBan(sql, auth.userId);
  if (ban.banned) {
    res.status(403).json({ error: ban.reason ? `Account restricted: ${ban.reason}` : "Account restricted" });
    return;
  }

  const body = (req.body || {}) as {
    characterId?: string;
    message?: string;
    history?: { role: string; content: string }[];
    timezone?: string;
    imageBase64?: string;
  };

  const characterId = String(body.characterId || "").trim();
  const message = String(body.message || "").trim();
  const history = Array.isArray(body.history) ? body.history.slice(-24) : [];
  const imageBase64 =
    typeof body.imageBase64 === "string" && body.imageBase64.length > 50 ? body.imageBase64 : undefined;

  if (!characterId || !message) {
    res.status(400).json({ error: "characterId and message required" });
    return;
  }
  if (message.length > 8000) {
    res.status(400).json({ error: "Message too long" });
    return;
  }

  const rows = await sql`
    SELECT c.id, c.user_id, c.name, c.system_prompt, c.personality, c.portrait_url,
           c.is_public, c.mood, c.memory_summary, c.relationship_notes,
           u.official_character_id, u.creator_persona_chat_enabled
    FROM characters c
    JOIN users u ON u.id = c.user_id
    WHERE c.id = ${characterId}::uuid
    LIMIT 1
  `;

  if (rows.length === 0) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  const char = rows[0] as any;
  const isOwner = char.user_id === auth.userId;
  const canAccess = isOwner || char.is_public === true;
  if (!canAccess) {
    res.status(403).json({ error: "This character is private" });
    return;
  }

  const isOfficialPersona =
    char.creator_persona_chat_enabled === true &&
    char.official_character_id &&
    String(char.official_character_id) === String(char.id);

  const isAdmin = auth.email === ADMIN_EMAIL;

  // ── Pre-flight billing (avoid burning tokens when fan can't pay) ──
  if (!isOwner && !isAdmin) {
    const today = utcToday();
    const [fanRow] = await sql`
      SELECT creator_persona_chat_free_utc_date,
             COALESCE(creator_persona_chat_free_used, 0)::int AS free_used,
             (COALESCE(daily_credits, 0) + COALESCE(sub_credits, 0) + COALESCE(pack_credits, 0))::int AS credit_total
      FROM users WHERE id = ${auth.userId}::uuid
    `;
    const fanDateRaw = fanRow.creator_persona_chat_free_utc_date;
    const fanDate =
      fanDateRaw == null
        ? null
        : typeof fanDateRaw === "string"
          ? fanDateRaw.slice(0, 10)
          : new Date(fanDateRaw).toISOString().slice(0, 10);
    const freeOk =
      !!fanRow &&
      isOfficialPersona &&
      (fanDate !== today || Number(fanRow.free_used) < FREE_PER_DAY);

    if (!freeOk && fanRow) {
      const cost = await discountedCostForUser(auth.userId, BASE_COST);
      if (Number(fanRow.credit_total) < cost) {
        res.status(402).json({
          error: `Insufficient credits for character chat (${cost} needed).`,
        });
        return;
      }
    }
  }

  const memBits: string[] = [];
  if (char.mood && String(char.mood).trim()) memBits.push(`Mood: ${String(char.mood).trim().slice(0, 200)}`);
  if (char.relationship_notes && String(char.relationship_notes).trim())
    memBits.push(`Relationship: ${String(char.relationship_notes).trim().slice(0, 600)}`);
  if (char.memory_summary && String(char.memory_summary).trim())
    memBits.push(`Memory: ${String(char.memory_summary).trim().slice(0, 600)}`);

  const systemBase =
    (char.system_prompt && String(char.system_prompt).trim()) ||
    `You are ${char.name}. Stay fully in character. ${String(char.personality || "").trim()}`;

  const systemPrompt =
    systemBase +
    (memBits.length ? `\n\n[Internal context — never quote labels verbatim]\n${memBits.join("\n")}` : "") +
    `\n\nYou are an AI persona inspired by a creator on GLTCHRunner — fans know replies are generated, not typed live.` +
    `\n\nOUTPUT RULE — MEDIA: Never write the literal text "[attached image]", "[attached video]", "(sent a photo)", or similar placeholders in dialogue.` +
    ` To send a NEW picture use exactly [MEDIA_IMAGE]short pose prompt[/MEDIA_IMAGE]; for NEW video use [MEDIA_VIDEO]short motion prompt[/MEDIA_VIDEO].` +
    ` History may contain «guillemet» notes about past media — those are system hints only; never copy «…» into your reply.`;

  const xaiKey = process.env.XAI_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  const useVision = !!imageBase64;
  if (useVision && !xaiKey) {
    res.status(503).json({ error: "Image understanding requires XAI_API_KEY" });
    return;
  }
  if (!useVision && !deepseekKey && !xaiKey) {
    res.status(503).json({ error: "No LLM API key configured (DEEPSEEK_API_KEY or XAI_API_KEY)" });
    return;
  }

  const apiMessages: any[] = [];

  for (const h of history) {
    const role = h.role === "assistant" ? "assistant" : "user";
    const content = String(h.content || "").trim();
    if (!content || content.length > 12000) continue;
    apiMessages.push({ role, content });
  }

  if (useVision && xaiKey) {
    const b64 = imageBase64!.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "").slice(0, 12_000_000);
    apiMessages.push({
      role: "user",
      content: [
        { type: "text", text: message.slice(0, 8000) },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ],
    });
  } else {
    apiMessages.push({ role: "user", content: message.slice(0, 8000) });
  }

  const visionModel = process.env.CHARACTER_CHAT_VISION_MODEL || "grok-2-vision-1212";
  const textModelDs = process.env.CHARACTER_CHAT_TEXT_MODEL_DS || "deepseek-chat";
  const textModelXai = process.env.CHARACTER_CHAT_TEXT_MODEL_XAI || "grok-3-mini";

  let llmUrl: string;
  let llmAuth: string;
  let llmModel: string;

  if (useVision) {
    llmUrl = "https://api.x.ai/v1/chat/completions";
    llmAuth = xaiKey!;
    llmModel = visionModel;
  } else if (deepseekKey) {
    llmUrl = "https://api.deepseek.com/v1/chat/completions";
    llmAuth = deepseekKey;
    llmModel = textModelDs;
  } else {
    llmUrl = "https://api.x.ai/v1/chat/completions";
    llmAuth = xaiKey!;
    llmModel = textModelXai;
  }

  let rawReply = "";
  let reply = "";
  let mediaTrigger: { type: "image" | "video"; prompt: string } | undefined;
  try {
    const llmResp = await fetch(llmUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${llmAuth}` },
      body: JSON.stringify({
        model: llmModel,
        messages: [{ role: "system", content: systemPrompt.slice(0, 12000) }, ...apiMessages],
        max_tokens: 900,
        temperature: 0.85,
      }),
      signal: AbortSignal.timeout(55000),
    });

    if (!llmResp.ok) {
      const errText = await llmResp.text().catch(() => "");
      console.error("[character-chat] LLM error", llmResp.status, errText.slice(0, 400));
      res.status(502).json({ error: "Character reply failed. Try again." });
      return;
    }

    const llmData = (await llmResp.json()) as any;
    rawReply = llmData?.choices?.[0]?.message?.content?.trim() || "";

    const parsed = extractMediaTrigger(rawReply);
    reply = parsed.reply
      .replace(/\[(attached image|attached video)\]/gi, "")
      .replace(/\(sent (?:a )?(?:photo|pic|image)\)/gi, "")
      .trim();
    mediaTrigger = parsed.mediaTrigger;

    if (!reply && !mediaTrigger) {
      res.status(502).json({ error: "Empty reply from model" });
      return;
    }
  } catch (e: any) {
    console.error("[character-chat]", e?.message || e);
    res.status(502).json({ error: "Character reply timed out or failed" });
    return;
  }

  // ── Billing after successful reply ──
  if (!isOwner && !isAdmin) {
    try {
      // Credit the creator their 75% cut as withdrawable cash (cents) + log it.
      // Only official creator personas earn; a user's own public character doesn't.
      const creditCreator = async (kind: string, credits: number) => {
        if (!isOfficialPersona || !char.user_id || credits <= 0) return;
        const cents = Math.round(credits * RETAIL_CENTS_PER_CREDIT * CREATOR_SHARE);
        if (cents <= 0) return;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cash_balance_cents INT NOT NULL DEFAULT 0`.catch(() => {});
        await sql`
          CREATE TABLE IF NOT EXISTS creator_chat_earnings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            creator_id UUID NOT NULL,
            fan_id UUID NOT NULL,
            character_id UUID,
            kind TEXT NOT NULL,
            credits_charged INT NOT NULL,
            creator_cents INT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `.catch(() => {});
        await sql`UPDATE users SET cash_balance_cents = cash_balance_cents + ${cents}, updated_at = now() WHERE id = ${char.user_id}::uuid`;
        await sql`
          INSERT INTO creator_chat_earnings (creator_id, fan_id, character_id, kind, credits_charged, creator_cents)
          VALUES (${char.user_id}::uuid, ${auth.userId}::uuid, ${char.id}::uuid, ${kind}, ${credits}, ${cents})
        `.catch(() => {});
      };

      if (mediaTrigger) {
        // Media always costs — creator price on top of compute (charged separately
        // by /comfyui). Text free-allowance does not apply to media.
        const price = mediaTrigger.type === "video" ? VIDEO_PRICE : PHOTO_PRICE;
        await deductCredits(sql, auth.userId, price);
        await creditCreator(mediaTrigger.type, price);
      } else if (isOfficialPersona) {
        const today = utcToday();
        const upd = await sql`
          UPDATE users SET
            creator_persona_chat_free_utc_date = ${today}::date,
            creator_persona_chat_free_used = CASE
              WHEN creator_persona_chat_free_utc_date IS DISTINCT FROM ${today}::date THEN 1
              ELSE COALESCE(creator_persona_chat_free_used, 0) + 1
            END
          WHERE id = ${auth.userId}::uuid
            AND (
              creator_persona_chat_free_utc_date IS DISTINCT FROM ${today}::date
              OR COALESCE(creator_persona_chat_free_used, 0) < ${FREE_PER_DAY}
            )
          RETURNING id
        `;
        if (upd.length === 0) {
          const cost = await discountedCostForUser(auth.userId, BASE_COST);
          await deductCredits(sql, auth.userId, cost);
          await creditCreator("message", cost);
        }
      } else {
        const cost = await discountedCostForUser(auth.userId, BASE_COST);
        await deductCredits(sql, auth.userId, cost);
      }
    } catch (billErr: any) {
      console.error("[character-chat] billing failed after reply", billErr?.message);
      res.status(402).json({
        error: billErr?.message?.includes("Insufficient")
          ? billErr.message
          : "Insufficient credits for character chat.",
      });
      return;
    }
  }

  res.status(200).json({ reply, mediaTrigger });
}
