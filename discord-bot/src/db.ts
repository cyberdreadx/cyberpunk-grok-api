import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "./config.js";

let _sql: NeonQueryFunction<false, false> | null = null;
export function getDb() {
  if (!_sql) _sql = neon(config.databaseUrl);
  return _sql;
}

export interface DiscordUser {
  id: string;
  discord_id: string;
  linked_user_id: string | null;
}

/** Upsert the Discord user row and return it. */
export async function ensureDiscordUser(discordId: string, username?: string): Promise<DiscordUser> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO discord_users (discord_id, username)
    VALUES (${discordId}, ${username || null})
    ON CONFLICT (discord_id) DO UPDATE
      SET username = COALESCE(EXCLUDED.username, discord_users.username),
          updated_at = now()
    RETURNING id, discord_id, linked_user_id
  `;
  return rows[0] as DiscordUser;
}

/** The linked web account's id + email (needed to mint a JWT), or null if unlinked. */
export async function getLinkedWebUser(discordId: string): Promise<{ userId: string; email: string } | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT u.id, u.email
    FROM discord_users d
    JOIN users u ON u.id = d.linked_user_id
    WHERE d.discord_id = ${discordId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return { userId: rows[0].id as string, email: rows[0].email as string };
}

/** Total spendable credits for the linked web account (sub + pack). */
export async function getCredits(discordId: string): Promise<number | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT (COALESCE(u.sub_credits,0) + COALESCE(u.pack_credits,0)) AS total
    FROM discord_users d JOIN users u ON u.id = d.linked_user_id
    WHERE d.discord_id = ${discordId} LIMIT 1
  `;
  return rows.length ? Number(rows[0].total) : null;
}

/** Create a one-time link code for this Discord user (verified on the web app). */
export async function createLinkCode(discordId: string, username?: string): Promise<string> {
  const sql = getDb();
  const du = await ensureDiscordUser(discordId, username);
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  await sql`DELETE FROM discord_link_codes WHERE discord_user_id = ${du.id}::uuid`;
  await sql`INSERT INTO discord_link_codes (code, discord_user_id) VALUES (${code}, ${du.id}::uuid)`;
  return code;
}
