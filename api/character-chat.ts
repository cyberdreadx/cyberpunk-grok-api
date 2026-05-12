/**
 * Character chat endpoint.
 *
 * POST /api/character-chat
 *   { characterId, message, history?, imageBase64?, timezone? }
 *
 * Routes to the LLM backend stored on the character row:
 *   - "deepseek" → Deepseek API (DEEPSEEK_API_KEY in Vercel env)
 *   - "gemini"   → Lovable AI Gateway (LOVABLE_API_KEY)
 *
 * Returns: { reply, mediaTrigger? }
 *   mediaTrigger is parsed from [MEDIA_IMAGE]…[/MEDIA_IMAGE] / [MEDIA_VIDEO]…[/MEDIA_VIDEO]
 *   tags emitted by the model — the client launches the actual generation.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: "10mb" } },
};

type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const GEMINI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const MEDIA_RE = /\[MEDIA_(IMAGE|VIDEO)\]([\s\S]*?)\[\/MEDIA_\1\]/i;

function parseMediaTrigger(text: string): { type: "image" | "video"; prompt: string } | null {
  const m = text.match(MEDIA_RE);
  if (!m) return null;
  const type = m[1].toLowerCase() === "video" ? "video" : "image";
  const prompt = (m[2] || "").trim().slice(0, 300);
  if (!prompt) return null;
  return { type, prompt };
}

async function callDeepseek(messages: ChatTurn[]): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY not configured on server");
  const r = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      max_tokens: 600,
      temperature: 0.85,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (r.status === 429) throw new Error("Deepseek rate-limited — try again in a moment.");
  if (r.status === 402 || r.status === 401) throw new Error("Deepseek auth/credits issue.");
  if (!r.ok) throw new Error(`Deepseek error ${r.status}`);
  const data = await r.json();
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

async function callGemini(messages: ChatTurn[]): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured on server");
  const r = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      max_tokens: 600,
      temperature: 0.85,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (r.status === 429) throw new Error("Gemini rate-limited — try again in a moment.");
  if (r.status === 402) throw new Error("AI gateway out of credits.");
  if (!r.ok) throw new Error(`Gemini error ${r.status}`);
  const data = await r.json();
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { allowed } = await checkRateLimit(auth.userId, "character-chat", { max: 30, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Slow down — too many messages." });

  const characterId = String((req.body || {}).characterId || "");
  const message = String((req.body || {}).message || "").slice(0, 4000);
  const history: ChatTurn[] = Array.isArray((req.body || {}).history)
    ? (req.body.history as any[])
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-20)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    : [];
  const imageBase64 = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64 : null;
  const timezone = String((req.body || {}).timezone || "UTC").slice(0, 64);

  if (!characterId) return res.status(400).json({ error: "characterId required" });
  if (!message && !imageBase64) return res.status(400).json({ error: "Message or image required" });

  const sql = getDb();

  // Load character (must be owned by user OR public)
  const rows = await sql`
    SELECT id, name, system_prompt, personality, traits, llm_backend
    FROM characters
    WHERE id = ${characterId} AND (user_id = ${auth.userId} OR is_public = true)
    LIMIT 1
  `;
  if (rows.length === 0) return res.status(404).json({ error: "Character not found" });
  const char = rows[0] as any;

  const backend: "deepseek" | "gemini" =
    char.llm_backend === "gemini" ? "gemini" : "deepseek";

  const sysPrompt = String(char.system_prompt || "").slice(0, 4000);
  const tzNote = `\n[Context: user timezone is ${timezone}.]`;

  const messages: ChatTurn[] = [
    { role: "system", content: sysPrompt + tzNote },
    ...history,
    {
      role: "user",
      content: imageBase64 && !message
        ? "[user sent you an image]"
        : imageBase64
        ? `${message}\n\n[user attached an image]`
        : message,
    },
  ];

  try {
    const reply = backend === "deepseek" ? await callDeepseek(messages) : await callGemini(messages);
    const cleanReply = reply || "*…*";
    const mediaTrigger = parseMediaTrigger(cleanReply);
    // Strip the media tag from the visible reply
    const visible = cleanReply.replace(MEDIA_RE, "").trim() || (mediaTrigger ? "*sending…*" : cleanReply);
    return res.status(200).json({
      reply: visible,
      backend,
      mediaTrigger: mediaTrigger || undefined,
    });
  } catch (err: any) {
    console.error("[character-chat]", err?.message);
    return res.status(500).json({ error: err?.message || "Chat failed" });
  }
}
