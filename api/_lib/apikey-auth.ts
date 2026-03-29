/**
 * Authenticate requests via developer API key (X-API-Key header).
 * Returns the user_id and api_key row if valid, or null.
 */

import { createHash } from "crypto";
import type { VercelRequest } from "@vercel/node";
import { getDb } from "./db";

export interface ApiKeyAuth {
  userId: string;
  apiKeyId: string;
  rateLimit: number;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function getUserFromApiKey(req: VercelRequest): Promise<ApiKeyAuth | null> {
  const raw = req.headers["x-api-key"] as string | undefined;
  if (!raw || !raw.startsWith("gltch_sk_")) return null;

  const keyHash = hashKey(raw);
  const sql = getDb();

  const rows = await sql`
    SELECT ak.id, ak.user_id, ak.rate_limit
    FROM api_keys ak
    WHERE ak.key_hash = ${keyHash} AND ak.is_active = true
  `;

  if (rows.length === 0) return null;

  // Update last_used_at and bump request count
  await sql`
    UPDATE api_keys SET last_used_at = now(), total_requests = total_requests + 1
    WHERE id = ${rows[0].id}
  `;

  return {
    userId: rows[0].user_id,
    apiKeyId: rows[0].id,
    rateLimit: rows[0].rate_limit,
  };
}
