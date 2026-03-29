/**
 * /api/api-keys — Manage developer API keys (create, list, revoke).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes, createHash } from "crypto";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

const MAX_KEYS_PER_USER = 5;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): string {
  const raw = randomBytes(32).toString("base64url");
  return `gltch_sk_${raw}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();

  try {
    // ── LIST keys ──
    if (req.method === "GET") {
      const { allowed } = await checkRateLimit(auth.userId, "api-keys-list", { max: 30, windowSeconds: 60 });
      if (!allowed) return res.status(429).json({ error: "Too many requests" });

      const rows = await sql`
        SELECT id, name, key_prefix, rate_limit, total_requests, total_credits,
               last_used_at, is_active, created_at, revoked_at
        FROM api_keys
        WHERE user_id = ${auth.userId}
        ORDER BY created_at DESC
      `;
      return res.status(200).json({ keys: rows });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body || {};
    const action = body.action as string;

    // ── CREATE key ──
    if (action === "create") {
      const { allowed } = await checkRateLimit(auth.userId, "api-keys-create", { max: 5, windowSeconds: 300 });
      if (!allowed) return res.status(429).json({ error: "Too many key creation attempts" });

      // Check max keys
      const [countRow] = await sql`
        SELECT COUNT(*)::int as count FROM api_keys
        WHERE user_id = ${auth.userId} AND is_active = true
      `;
      if (countRow.count >= MAX_KEYS_PER_USER) {
        return res.status(400).json({ error: `Maximum ${MAX_KEYS_PER_USER} active API keys allowed` });
      }

      const name = (body.name as string || "Default").slice(0, 100);
      const rawKey = generateApiKey();
      const keyHash = hashKey(rawKey);
      const keyPrefix = rawKey.slice(0, 16) + "...";

      await sql`
        INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
        VALUES (${auth.userId}, ${name}, ${keyHash}, ${keyPrefix})
      `;

      // Return the raw key ONCE — it won't be retrievable again
      return res.status(201).json({
        key: rawKey,
        prefix: keyPrefix,
        name,
        message: "Save this key — it won't be shown again.",
      });
    }

    // ── REVOKE key ──
    if (action === "revoke") {
      const keyId = body.keyId as string;
      if (!keyId) return res.status(400).json({ error: "keyId required" });

      const result = await sql`
        UPDATE api_keys
        SET is_active = false, revoked_at = now()
        WHERE id = ${keyId} AND user_id = ${auth.userId} AND is_active = true
      `;
      // neon returns array; length check
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err: any) {
    console.error("[api-keys]", err.message, err.stack);
    return res.status(500).json({ error: "Internal error" });
  }
}
