/**
 * Chat API for AI companion conversations.
 *
 * POST { action: "message" }        — Send a message, get AI response
 * POST { action: "generate-media" } — Generate media from character context
 *
 * Routes to Grok (xAI) or DeepSeek based on character config.
 *
 * Emotional memory: after each reply the LLM silently extracts mood shifts,
 * key facts about the user, and relationship dynamics. These are persisted
 * server-side and injected into the system prompt on subsequent turns so
 * the character "remembers" across sessions without any visible UI.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

export const config = {
  maxDuration: 60,
};

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const ADMIN_EMAIL = "cyberdreadx@proton.me";

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";
const GROK_BASE = "https://api.x.ai/v1";

const VIDEO_LORA_CATEGORIES: Record<string, { loraName: string; strength: number; description: string }> = {
  "nsfw_helper":  { loraName: "wan22-k3nk4llinon3-k3nk", strength: 0.7, description: "General NSFW motion enhancement" },
  "solo_touch":   { loraName: "wan2.2_t2v_masturbation_v1.0", strength: 0.7, description: "Self-pleasure, rubbing, fingering" },
  "dual_action":  { loraName: "WAN-2.2-I2V-HandjobBlowjobCombo-v1", strength: 0.8, description: "Handjob + oral combination" },
  "pov_behind":   { loraName: "doggyPOV_v1_1", strength: 0.8, description: "POV doggy style from behind" },
  "nude_posing":  { loraName: "W22_NSFW_Posing_Nude_i2v_v2", strength: 0.7, description: "Nude model posing, photoshoot style" },
  "anatomy":      { loraName: "PussyLoRA_Wan2.2_HearmemanAI", strength: 0.7, description: "Detailed anatomy closeup focus" },
};

async function callLLM(
  backend: "grok" | "deepseek",
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; vision?: boolean } = {},
): Promise<string> {
  const { maxTokens = 600, temperature = 0.85, vision = false } = opts;

  let apiKey: string;
  let baseUrl: string;
  let model: string;

  if (backend === "grok") {
    apiKey = process.env.XAI_API_KEY || "";
    if (!apiKey) throw new Error("XAI_API_KEY not configured");
    baseUrl = GROK_BASE;
    model = vision ? "grok-2-vision-latest" : "grok-3-mini";
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
    signal: AbortSignal.timeout(vision ? 60000 : 30000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`LLM API returned ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await resp.json()) as any;
  return data.choices?.[0]?.message?.content || "";
}

interface MediaTrigger {
  type: "image" | "video";
  prompt: string;
  videoLora?: string;
  videoLoraStrength?: number;
  cameraAngle?: string;
}

function resolveLoraCategory(slug: string | undefined): { videoLora?: string; videoLoraStrength?: number } {
  if (!slug || slug === "none") return {};
  const entry = VIDEO_LORA_CATEGORIES[slug];
  if (!entry) return {};
  return { videoLora: entry.loraName, videoLoraStrength: entry.strength };
}

function parseMediaAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function extractMediaTrigger(text: string): MediaTrigger | null {
  const imgMatch = text.match(/\[MEDIA_IMAGE([^\]]*)\](.*?)\[\/MEDIA_IMAGE\]/s);
  if (imgMatch) {
    const attrs = parseMediaAttrs(imgMatch[1]);
    return { type: "image", prompt: imgMatch[2].trim(), cameraAngle: attrs.angle || undefined };
  }

  const vidMatch = text.match(/\[MEDIA_VIDEO([^\]]*)\](.*?)\[\/MEDIA_VIDEO\]/s);
  if (vidMatch) {
    const attrs = parseMediaAttrs(vidMatch[1]);
    const prompt = vidMatch[2].trim();
    return { type: "video", prompt, ...resolveLoraCategory(attrs.lora), cameraAngle: attrs.angle || undefined };
  }

  // Fallback: LLM said it sent a photo/video without using proper tags
  const sentPhotoPattern = /\b(?:sent? (?:you )?a (?:photo|pic|picture|selfie|image)|sends? (?:a )?(?:photo|pic|picture|selfie|image)|here(?:'s| is) (?:a |my )?(?:photo|pic|picture|selfie|image)|takes? a (?:photo|pic|picture|selfie|image)|snaps? a (?:photo|pic|picture|selfie|image))\b/i;
  const sentVideoPattern = /\b(?:sent? (?:you )?a (?:video|clip|vid)|sends? (?:a )?(?:video|clip|vid)|here(?:'s| is) (?:a |my )?(?:video|clip|vid))\b/i;

  if (sentVideoPattern.test(text)) {
    const description = text
      .replace(/\*[^*]*\*/g, " ")
      .replace(/[()]/g, "")
      .trim()
      .slice(0, 200);
    return { type: "video", prompt: description || "casual selfie video, smiling at camera" };
  }

  if (sentPhotoPattern.test(text)) {
    const description = text
      .replace(/\*[^*]*\*/g, " ")
      .replace(/[()]/g, "")
      .trim()
      .slice(0, 200);
    return { type: "image", prompt: description || "casual selfie, looking at camera, natural lighting" };
  }

  return null;
}

function stripMediaTags(text: string): string {
  return text
    .replace(/\[MEDIA_IMAGE(?:\s+[^[\]]*?)?\].*?\[\/MEDIA_IMAGE\]/gs, "")
    .replace(/\[MEDIA_VIDEO(?:\s+[^[\]]*?)?\].*?\[\/MEDIA_VIDEO\]/gs, "")
    .replace(/\[MEDIA_IMAGE(?:\s+[^[\]]*?)?\][^[]*$/gs, "")
    .replace(/\[MEDIA_VIDEO(?:\s+[^[\]]*?)?\][^[]*$/gs, "")
    .replace(/\[\/?MEDIA_IMAGE\]/g, "")
    .replace(/\[\/?MEDIA_VIDEO\]/g, "")
    .replace(/\(sent a (?:photo|video|pic|picture|image)\)/gi, "")
    .replace(/\[attached (?:image|video)\]/gi, "")
    .trim();
}

// ── Emotional memory extraction ──────────────────────────────────────────
// Runs as a non-blocking background call after the main reply is sent.
// Asks the LLM to introspect on the conversation and produce structured
// internal state updates that persist across sessions.

const MEMORY_EXTRACTION_PROMPT = `You are an internal process for an AI character. Analyze the conversation that just happened and output ONLY a JSON object with these fields — no other text:

{
  "mood": "a single word or short phrase describing the character's current emotional state (e.g. 'warm', 'teasing', 'melancholy', 'excited', 'guarded', 'playful', 'irritated')",
  "new_memories": "important facts you learned about the user in this exchange that should be remembered long-term. Include names, preferences, life events, opinions, inside jokes. Empty string if nothing new.",
  "relationship_update": "how the relationship dynamic shifted in this exchange, if at all. e.g. 'growing closer', 'user seemed distant', 'shared something vulnerable', 'playful banter'. Empty string if no change."
}

Be concise. Only include genuinely important things to remember. Do not repeat things already in the existing memory.`;

interface MemoryExtraction {
  mood: string;
  new_memories: string;
  relationship_update: string;
}

async function extractMemory(
  backend: "grok" | "deepseek",
  characterName: string,
  existingMemory: string,
  existingRelationship: string,
  recentMessages: ChatMessage[],
): Promise<MemoryExtraction | null> {
  try {
    const contextMessages: ChatMessage[] = [
      {
        role: "system",
        content: [
          MEMORY_EXTRACTION_PROMPT,
          existingMemory ? `\nExisting memories about the user:\n${existingMemory}` : "",
          existingRelationship ? `\nCurrent relationship dynamic:\n${existingRelationship}` : "",
          `\nYou are processing for character: ${characterName}`,
        ].join(""),
      },
      {
        role: "user",
        content: `Here is the recent conversation:\n\n${recentMessages
          .filter(m => m.role !== "system")
          .map(m => `${m.role}: ${m.content}`)
          .join("\n")}\n\nOutput the JSON now.`,
      },
    ];

    const raw = await callLLM(backend, contextMessages, { maxTokens: 300, temperature: 0.3 });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      mood: String(parsed.mood || "neutral").slice(0, 50),
      new_memories: String(parsed.new_memories || "").slice(0, 1000),
      relationship_update: String(parsed.relationship_update || "").slice(0, 500),
    };
  } catch {
    return null;
  }
}

function buildEmotionalSystemPrompt(
  basePrompt: string,
  mood: string | null,
  memorySummary: string | null,
  relationshipNotes: string | null,
  timezone?: string,
): string {
  const parts = [basePrompt];

  if (mood && mood !== "neutral") {
    parts.push(`\n[Internal state — do not mention this directly] You are currently feeling ${mood}. Let this subtly color your tone and word choice without explicitly stating your mood.`);
  }

  if (memorySummary) {
    parts.push(`\n[Long-term memory — things you remember about the user] ${memorySummary}\nUse these naturally in conversation when relevant. Never say "I remember you told me..." — just know these things the way a real person would.`);
  }

  if (relationshipNotes) {
    parts.push(`\n[Relationship context] ${relationshipNotes}\nLet this inform how open, warm, guarded, or playful you are.`);
  }

  // Real-time awareness — use the user's timezone if provided
  const tz = timezone || "UTC";
  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // Get hour in user's timezone
  const userHour = parseInt(now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }), 10) || 0;
  const timeOfDay = userHour < 6 ? "late night" : userHour < 12 ? "morning" : userHour < 17 ? "afternoon" : userHour < 21 ? "evening" : "night";
  const timeStr = now.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
  const dayStr = now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { timeZone: tz, month: "long", day: "numeric", year: "numeric" });
  parts.push(`\n[Current context — use naturally, do not announce] It is ${dayStr}, ${dateStr}, ${timeStr} (${timeOfDay}). React to the time naturally — for example greetings, commenting if it's late, weekend vibes, etc.`);

  // Video LoRA style guidance
  const styleList = Object.entries(VIDEO_LORA_CATEGORIES)
    .map(([slug, v]) => `${slug} — ${v.description}`)
    .join("; ");
  parts.push(`\n[Media generation — video styles] When you send a video, you may pick a style that best matches the scene by adding a lora attribute: [MEDIA_VIDEO lora="slug"]description[/MEDIA_VIDEO]. Available styles: none (default — general motion); ${styleList}. Pick the style that best fits the action. If nothing specific fits or the scene is SFW, omit the lora attribute entirely.`);

  // Camera angle guidance for both images and videos
  parts.push(`\n[Media generation — camera angles] You can optionally specify a camera angle for images or videos by adding angle="..." to the tag. Available angles: closeup (face/detail), wide (full body/scene), topdown (overhead view), forward (move closer), pov_down (looking down at subject). Examples: [MEDIA_IMAGE angle="closeup"]description[/MEDIA_IMAGE] or [MEDIA_VIDEO lora="slug" angle="wide"]description[/MEDIA_VIDEO]. Pick the angle that best frames the scene. If unsure, omit the angle attribute.`);

  return parts.join("");
}

async function persistMemoryUpdate(
  sql: any,
  characterId: string,
  extraction: MemoryExtraction,
  existingMemory: string,
  existingRelationship: string,
) {
  const newMood = extraction.mood || "neutral";

  let updatedMemory = existingMemory || "";
  if (extraction.new_memories) {
    updatedMemory = updatedMemory
      ? `${updatedMemory}\n${extraction.new_memories}`
      : extraction.new_memories;
    // Cap at ~2000 chars — keep recent memories, trim oldest
    if (updatedMemory.length > 2000) {
      const lines = updatedMemory.split("\n");
      while (lines.join("\n").length > 2000 && lines.length > 1) lines.shift();
      updatedMemory = lines.join("\n");
    }
  }

  let updatedRelationship = existingRelationship || "";
  if (extraction.relationship_update) {
    updatedRelationship = updatedRelationship
      ? `${updatedRelationship}\n${extraction.relationship_update}`
      : extraction.relationship_update;
    if (updatedRelationship.length > 1000) {
      const lines = updatedRelationship.split("\n");
      while (lines.join("\n").length > 1000 && lines.length > 1) lines.shift();
      updatedRelationship = lines.join("\n");
    }
  }

  try {
    await sql`
      UPDATE characters SET
        mood = ${newMood},
        memory_summary = ${updatedMemory},
        relationship_notes = ${updatedRelationship},
        mood_updated_at = now()
      WHERE id = ${characterId}
    `;
  } catch (e) {
    console.error("[chat] Failed to persist memory:", e);
  }
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
      const { characterId, message, history, imageBase64 } = req.body;
      if (!characterId) return res.status(400).json({ error: "characterId required" });
      if (!message || typeof message !== "string" || message.trim().length < 1)
        return res.status(400).json({ error: "Message is required" });
      if (message.length > 2000)
        return res.status(400).json({ error: "Message must be 2000 characters or less" });

      const hasImage = typeof imageBase64 === "string" && imageBase64.length > 100;

      const { allowed } = await checkRateLimit(auth.userId, "chat-message", { max: 30, windowSeconds: 60 });
      if (!allowed) return res.status(429).json({ error: "Slow down — too many messages" });

      // Fetch character with emotional memory fields
      const chars = await sql`
        SELECT id, name, system_prompt, llm_backend, portrait_url,
               mood, memory_summary, relationship_notes
        FROM characters WHERE id = ${characterId} AND user_id = ${auth.userId}
      `;
      if (chars.length === 0) return res.status(404).json({ error: "Character not found" });
      const char = chars[0];

      if (char.llm_backend === "deepseek") {
        char.llm_backend = "grok";
        sql`UPDATE characters SET llm_backend = 'grok' WHERE id = ${characterId}`.catch(() => {});
      }

      // Deduct 1 credit per message (DB requires integers)
      const testCredits = req.body.testCredits && isAdmin;
      if (!isAdmin || testCredits) {
        const rows = await sql`SELECT sub_credits, pack_credits FROM users WHERE id = ${auth.userId}`;
        if (rows.length === 0) return res.status(404).json({ error: "User not found" });
        const total = (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
        if (total < 1) {
          return res.status(402).json({ error: "Insufficient credits. Each chat message costs 1 credit." });
        }
        await sql`SELECT deduct_credits(${auth.userId}::uuid, 1)`;
      }

      // Build system prompt with emotional memory layered in
      const baseSystemPrompt = char.system_prompt || `You are ${char.name}. You are a real person, not an AI. Stay in character at all times. Never break immersion.`;
      const fullSystemPrompt = buildEmotionalSystemPrompt(
        baseSystemPrompt,
        char.mood,
        char.memory_summary,
        char.relationship_notes,
        req.body.timezone,
      );

      const messages: ChatMessage[] = [
        { role: "system", content: fullSystemPrompt },
      ];

      if (hasImage) {
        messages[0].content += `\n[Reference image] The user has shared a photo. You can see it and should react naturally — comment on it, flirt about it, etc. If you decide to generate media in response, you can incorporate elements from their image.`;
      }

      // Add recent history (last 20 messages to stay within context limits)
      const historyArr = Array.isArray(history) ? history.slice(-20) : [];
      for (const msg of historyArr) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: String(msg.content).slice(0, 2000) });
        }
      }

      // Build the user message — multimodal if image attached
      if (hasImage) {
        messages.push({
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageBase64 } },
            { type: "text", text: message.trim() },
          ] as any,
        });
      } else {
        messages.push({ role: "user", content: message.trim() });
      }

      const response = await callLLM(char.llm_backend || "grok", messages, { vision: hasImage });

      const mediaTrigger = extractMediaTrigger(response);
      const cleanText = stripMediaTags(response);

      // Log usage
      try {
        await sql`INSERT INTO usage_log (user_id, mode, credits_used)
          VALUES (${auth.userId}::uuid, 'chat-message', 0)`;
      } catch { /* best effort */ }

      // Send reply immediately — don't make the user wait for memory extraction
      res.status(200).json({
        reply: cleanText,
        mediaTrigger,
        characterName: char.name,
      });

      // Fire-and-forget: extract emotional memory from this exchange
      // Uses the last few messages + the new reply for context
      const memoryContext: ChatMessage[] = [
        ...historyArr.slice(-6).filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 500) })),
        { role: "user", content: message.trim() },
        { role: "assistant", content: cleanText },
      ];

      extractMemory(
        char.llm_backend || "grok",
        char.name,
        char.memory_summary || "",
        char.relationship_notes || "",
        memoryContext,
      ).then(extraction => {
        if (extraction) {
          persistMemoryUpdate(
            sql,
            characterId,
            extraction,
            char.memory_summary || "",
            char.relationship_notes || "",
          );
        }
      }).catch(() => { /* silent — memory is best-effort */ });

      return;
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
