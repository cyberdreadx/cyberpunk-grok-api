/**
 * POST /api/creator-persona-chat
 *
 * Featured / creator accounts: link one published Character as the official
 * fan-facing AI persona and toggle optional discovery CTAs.
 *
 * Body: { action: "get" | "set", officialCharacterId?, creatorPersonaChatEnabled? }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "creator-persona-chat", { max: 40, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Too many requests" });

  const sql = getDb();
  const { action, officialCharacterId, creatorPersonaChatEnabled } = (req.body || {}) as {
    action?: string;
    officialCharacterId?: string | null;
    creatorPersonaChatEnabled?: boolean;
  };

  try {
    if (action === "get") {
      const [u] = await sql`
        SELECT official_character_id, creator_persona_chat_enabled
        FROM users WHERE id = ${auth.userId}::uuid
      `;
      const chars = await sql`
        SELECT id, name, is_public
        FROM characters WHERE user_id = ${auth.userId}::uuid
        ORDER BY updated_at DESC
      `;
      return res.status(200).json({
        officialCharacterId: u?.official_character_id || null,
        creatorPersonaChatEnabled: !!u?.creator_persona_chat_enabled,
        characters: chars,
      });
    }

    if (action === "set") {
      let nextOfficial: string | null =
        officialCharacterId === undefined ? undefined : officialCharacterId ? String(officialCharacterId).trim() : null;
      const nextEnabled =
        creatorPersonaChatEnabled === undefined ? undefined : !!creatorPersonaChatEnabled;

      const [cur] = await sql`
        SELECT official_character_id, creator_persona_chat_enabled FROM users WHERE id = ${auth.userId}::uuid
      `;

      const resolvedOfficial =
        nextOfficial !== undefined ? nextOfficial : cur?.official_character_id || null;
      let resolvedEnabled =
        nextEnabled !== undefined ? nextEnabled : !!cur?.creator_persona_chat_enabled;

      if (!resolvedOfficial) resolvedEnabled = false;

      if (resolvedEnabled && !resolvedOfficial) {
        return res.status(400).json({
          error: "Pick an official character before enabling fan chat.",
        });
      }

      if (resolvedOfficial) {
        const [ch] = await sql`
          SELECT id, is_public FROM characters
          WHERE id = ${resolvedOfficial}::uuid AND user_id = ${auth.userId}::uuid
        `;
        if (!ch) return res.status(404).json({ error: "Character not found" });
        if (!ch.is_public) {
          return res.status(400).json({
            error: "Publish your character (Public) before linking it as your official persona.",
          });
        }
      }

      await sql`
        UPDATE users SET
          official_character_id = ${resolvedOfficial},
          creator_persona_chat_enabled = ${resolvedEnabled},
          updated_at = now()
        WHERE id = ${auth.userId}::uuid
      `;

      return res.status(200).json({
        officialCharacterId: resolvedOfficial,
        creatorPersonaChatEnabled: resolvedEnabled,
      });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e: any) {
    console.error("[creator-persona-chat]", e?.message || e);
    return res.status(500).json({ error: "Failed" });
  }
}
