import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

/**
 * /api/discord-link — link a logged-in web account to a Discord user.
 *
 * The Discord bot (discord-bot/) issues a short code via `/link`; the user pastes
 * it here while logged into the web app. We verify the code and set
 * discord_users.linked_user_id so the bot can spend this account's credits.
 *
 *   GET                 → { linked: boolean, discordId: string | null }
 *   POST { code }       → { linked: true, discordId } | 400 invalid/expired
 *
 * Tables are also created by discord-bot/migrations.sql; we ensure them here so the
 * web side works regardless of which ran first.
 */

let schemaReady = false;
async function ensureSchema(sql: ReturnType<typeof getDb>) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS discord_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      discord_id text UNIQUE NOT NULL,
      username text,
      linked_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS discord_link_codes (
      code text PRIMARY KEY,
      discord_user_id uuid NOT NULL REFERENCES discord_users(id) ON DELETE CASCADE,
      used boolean NOT NULL DEFAULT false,
      expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  schemaReady = true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "discord-link", { max: 20, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

  const sql = getDb();
  try {
    await ensureSchema(sql);

    if (req.method === "GET") {
      const [row] = await sql`
        SELECT discord_id FROM discord_users
        WHERE linked_user_id = ${auth.userId}::uuid
        LIMIT 1
      `;
      return res.status(200).json({ linked: !!row, discordId: row?.discord_id || null });
    }

    if (req.method === "POST") {
      const code = String(req.body?.code ?? "").trim().toUpperCase();
      if (!code || code.length > 12) return res.status(400).json({ error: "Invalid code" });

      // Atomically: claim an unused, unexpired code and link this web user to it.
      const [linked] = await sql`
        WITH c AS (
          UPDATE discord_link_codes
          SET used = true
          WHERE code = ${code} AND used = false AND expires_at > now()
          RETURNING discord_user_id
        )
        UPDATE discord_users d
        SET linked_user_id = ${auth.userId}::uuid, updated_at = now()
        FROM c
        WHERE d.id = c.discord_user_id
        RETURNING d.discord_id
      `;
      if (!linked) return res.status(400).json({ error: "Invalid or expired code" });

      return res.status(200).json({ linked: true, discordId: linked.discord_id });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[discord-link]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
}
