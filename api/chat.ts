/**
 * Chat API for AI companion conversations.
 *
 * POST { action: "message" }        — Send a message, get AI response
 * POST { action: "generate-media" } — Generate media from character context
 *
 * Routes to Grok (xAI) or DeepSeek based on character config.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const ADMIN_EMAIL = "cyberdreadx@proton.me";

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";
const GROK_BASE = "https://api.x.ai/v1";

async function callLLM(
  backend: "grok" | "deepseek",
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const { maxTokens = 600, temperature = 0.85 } = opts;

  let apiKey: string;
  let baseUrl: string;
  let model: string;

  if (backend === "grok") {
    apiKey = process.env.XAI_API_KEY || "";
    if (!apiKey) throw new Error("XAI_API_KEY not configured");
    baseUrl = GROK_BASE;
    model = "grok-3-mini";
  } else {
    apiKey = process.env.DEEPSEEK_API_KEY || "";
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY not configured");
    baseUrl = DEEPSEEK_BASE;
    model = "deepseek-chat";
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`LLM API returned ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await resp.json()) as any;
  return data.choices?.[0]?.message?.content || "";
}

function extractMediaTrigger(text: string): { type: "image" | "video"; prompt: string } | null {
  const imgMatch = text.match(/\[MEDIA_IMAGE\](.*?)\[\/MEDIA_IMAGE\]/s);
  if (imgMatch) return { type: "image", prompt: imgMatch[1].trim() };
  const vidMatch = text.match(/\[MEDIA_VIDEO\](.*?)\[\/MEDIA_VIDEO\]/s);
  if (vidMatch) return { type: "video", prompt: vidMatch[1].trim() };
  return null;
}

function stripMediaTags(text: string): string {
  return text
    .replace(/\[MEDIA_IMAGE\].*?\[\/MEDIA_IMAGE\]/gs, "")
    .replace(/\[MEDIA_VIDEO\].*?\[\/MEDIA_VIDEO\]/gs, "")
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { action } = req.body;
  const sql = getDb();
  const isAdmin = auth.email === ADMIN_EMAIL;

  try {
    if (action === "message") {
      const { characterId, message, history } = req.body;
      if (!characterId) return res.status(400).json({ error: "characterId required" });
      if (!message || typeof message !== "string" || message.trim().length < 1)
        return res.status(400).json({ error: "Message is required" });
      if (message.length > 2000)
        return res.status(400).json({ error: "Message must be 2000 characters or less" });

      const { allowed } = await checkRateLimit(auth.userId, "chat-message", { max: 30, windowSeconds: 60 });
      if (!allowed) return res.status(429).json({ error: "Slow down — too many messages" });

      // Fetch character
      const chars = await sql`
        SELECT id, name, system_prompt, llm_backend, portrait_url
        FROM characters WHERE id = ${characterId} AND user_id = ${auth.userId}
      `;
      if (chars.length === 0) return res.status(404).json({ error: "Character not found" });
      const char = chars[0];

      // Check credits (1 credit per 10 messages, tracked via usage_log count)
      const testCredits = req.body.testCredits && isAdmin;
      if (!isAdmin || testCredits) {
        const creditCheck = await sql`SELECT deduct_credits(${auth.userId}, 0.1)`;
        if (!creditCheck[0].deduct_credits) {
          return res.status(402).json({ error: "Insufficient credits. Each chat message costs ~0.1 credits." });
        }
      }

      // Build conversation
      const messages: ChatMessage[] = [
        { role: "system", content: char.system_prompt || `You are ${char.name}, an AI companion.` },
      ];

      // Add recent history (last 20 messages to stay within context limits)
      const historyArr = Array.isArray(history) ? history.slice(-20) : [];
      for (const msg of historyArr) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: String(msg.content).slice(0, 2000) });
        }
      }

      messages.push({ role: "user", content: message.trim() });

      const response = await callLLM(char.llm_backend || "deepseek", messages);

      // Check for media triggers in the response
      const mediaTrigger = extractMediaTrigger(response);
      const cleanText = stripMediaTags(response);

      // Log usage
      try {
        await sql`INSERT INTO usage_log (user_id, action, tokens_used)
          VALUES (${auth.userId}, 'chat-message', ${response.length})`;
      } catch { /* best effort */ }

      return res.status(200).json({
        reply: cleanText || response,
        mediaTrigger,
        characterName: char.name,
      });
    }

    if (action === "generate-media") {
      const { characterId, type, prompt } = req.body;
      if (!characterId) return res.status(400).json({ error: "characterId required" });
      if (!type || !["image", "video"].includes(type))
        return res.status(400).json({ error: "type must be 'image' or 'video'" });
      if (!prompt || typeof prompt !== "string")
        return res.status(400).json({ error: "prompt is required" });

      const { allowed } = await checkRateLimit(auth.userId, "chat-media", { max: 10, windowSeconds: 60 });
      if (!allowed) return res.status(429).json({ error: "Too many media requests" });

      const chars = await sql`
        SELECT id, name, portrait_url FROM characters
        WHERE id = ${characterId} AND user_id = ${auth.userId}
      `;
      if (chars.length === 0) return res.status(404).json({ error: "Character not found" });

      // Return the generation params — the frontend will call comfyui/gltch endpoints directly
      return res.status(200).json({
        action: "generate",
        type,
        prompt: prompt.slice(0, 1000),
        portraitUrl: chars[0].portrait_url || null,
        characterName: chars[0].name,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error("[chat] Error:", err);
    if (err.message?.includes("not configured")) {
      return res.status(503).json({ error: "Chat backend not configured. Ask the admin to set up the API key." });
    }
    return res.status(500).json({ error: "Chat failed. Please try again." });
  }
}
