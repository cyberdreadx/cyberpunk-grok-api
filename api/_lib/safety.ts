/**
 * Private content-safety filter.
 *
 * All blocked patterns live in the SAFETY_BLOCKLIST env var (base64-encoded JSON),
 * so nothing sensitive appears in the repo. Runs entirely on your server —
 * no data is sent to any third party.
 *
 * Env var format (base64 of JSON):
 * {
 *   "minor_terms": ["term1", "term2"],
 *   "explicit_terms": ["term1", "term2"],
 *   "absolute_blocks": ["phrase that is always blocked"]
 * }
 *
 * Logic:
 * - If the prompt contains ANY "absolute_blocks" phrase → blocked
 * - If the prompt contains BOTH a "minor_terms" match AND an "explicit_terms" match → blocked
 * - Otherwise → allowed
 */

import { getDb } from "./db";

interface Blocklist {
  minor_terms: string[];
  explicit_terms: string[];
  absolute_blocks: string[];
}

let _cached: Blocklist | null = null;

function getBlocklist(): Blocklist {
  if (_cached) return _cached;

  const raw = process.env.SAFETY_BLOCKLIST || "";
  if (!raw) {
    console.warn("[safety] SAFETY_BLOCKLIST env var is empty — no prompt filtering active.");
    return { minor_terms: [], explicit_terms: [], absolute_blocks: [] };
  }

  try {
    const json = Buffer.from(raw, "base64").toString("utf-8");
    _cached = JSON.parse(json) as Blocklist;
    return _cached;
  } catch (err: any) {
    console.error("[safety] Failed to parse SAFETY_BLOCKLIST:", err.message);
    return { minor_terms: [], explicit_terms: [], absolute_blocks: [] };
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SafetyResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Check a prompt against the private blocklist.
 * Returns { blocked: true, reason } if the prompt is unsafe.
 */
export function checkPrompt(prompt: string): SafetyResult {
  const bl = getBlocklist();
  if (!bl.minor_terms.length && !bl.explicit_terms.length && !bl.absolute_blocks.length) {
    return { blocked: false };
  }

  const text = normalize(prompt);

  // Check absolute blocks first
  for (const phrase of bl.absolute_blocks) {
    if (text.includes(normalize(phrase))) {
      return { blocked: true, reason: "absolute" };
    }
  }

  // Check for combination of minor + explicit terms
  const hasMinor = bl.minor_terms.some((t) => text.includes(normalize(t)));
  const hasExplicit = bl.explicit_terms.some((t) => text.includes(normalize(t)));

  if (hasMinor && hasExplicit) {
    return { blocked: true, reason: "minor+explicit" };
  }

  return { blocked: false };
}

/**
 * Log a safety violation to the database. Only visible to you (admin).
 */
export async function logSafetyViolation(
  userId: string,
  endpoint: string,
  prompt: string,
  reason: string,
): Promise<void> {
  try {
    const sql = getDb();
    await sql`
      INSERT INTO safety_log (user_id, endpoint, prompt, reason)
      VALUES (${userId}::uuid, ${endpoint}, ${prompt.slice(0, 2000)}, ${reason})
    `;
  } catch (err: any) {
    // If the table doesn't exist yet, just console log
    console.error("[safety] Failed to log violation (table may not exist):", err.message);
    console.warn(`[safety-violation] user=${userId} endpoint=${endpoint} reason=${reason} prompt=${prompt.slice(0, 200)}`);
  }
}
