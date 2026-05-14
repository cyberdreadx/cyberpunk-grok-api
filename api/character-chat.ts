/**
 * Character companion chat — delegates to shared handler (billing, vision, media tags).
 *
 * POST /api/character-chat
 *   { characterId, message, history?, imageBase64?, timezone? }
 *
 * Returns: { reply, mediaTrigger? }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { handleCharacterChatMessage } from "./_lib/character-chat-message";

export const config = {
  maxDuration: 90,
  api: { bodyParser: { sizeLimit: "12mb" } },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const sql = getDb();
  await handleCharacterChatMessage(req, res, auth, sql);
}
