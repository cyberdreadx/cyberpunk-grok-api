/**
 * Adult LoRAs and who may use them — enforced on the server.
 *
 * The create screen shows these locked until the account has LoRA access, but
 * until 2026-10-08 that lock was the only one for edit and Krea 2 LoRAs: the
 * generate endpoints accepted any LoRA name, so a request sent directly (or
 * through the developer API) got them free. Video LoRAs had a server gate;
 * edit and Krea 2 did not. Every generate path now checks here.
 *
 * Access is the same as the paid unlock in the UI: an admin, the one-time $30
 * Stripe LoRA unlock (users.lora_unlocked), or a verified XRGE purchase or
 * bank deposit.
 *
 * Keep in sync with the nsfw flags in src/pages/Index.tsx (EDIT_LORA_META,
 * KREA2_LORA_META). A LoRA missing from here is not gated, so adding a new
 * adult LoRA means adding it here too.
 */

import { getDb } from "./db";

const ADULT_LORAS = new Set(
  [
    // Flux 2 Klein edit
    "klein_snofs_v1_4.safetensors",
    "KLEIN-Unchained-V2.safetensors",
    "klein-deepthroat-15epoc-k3nk.safetensors",
    "cowgirl_20260123_04-36-14epoch35.safetensors",
    "bj_20260120_22-22-29epoch15_comfy.safetensors",
    // Krea 2
    "realcumk4.safetensors",
  ].map((n) => n.toLowerCase()),
);

/** Matches by file name, ignoring case and any folder prefix. */
export function isAdultLora(name: string | null | undefined): boolean {
  if (!name || name === "none") return false;
  const base = String(name).split(/[\\/]/).pop()!.toLowerCase();
  return ADULT_LORAS.has(base);
}

/** The LoRA names a generate request asks for, from either request shape. */
export function requestedLoras(body: { lora?: unknown; loras?: unknown }): string[] {
  const names: string[] = [];
  if (typeof body.lora === "string") names.push(body.lora);
  if (Array.isArray(body.loras)) {
    for (const l of body.loras) {
      if (l && typeof l === "object" && typeof (l as { name?: unknown }).name === "string") {
        names.push((l as { name: string }).name);
      }
    }
  }
  return names;
}

/** Whether this account has paid for (or holds) LoRA access. */
export async function hasLoraAccess(userId: string, isAdmin = false): Promise<boolean> {
  if (isAdmin) return true;
  const sql = getDb();
  const [row] = await sql`SELECT lora_unlocked FROM users WHERE id = ${userId}`;
  if (row?.lora_unlocked) return true;
  const orders = await sql`SELECT 1 FROM xrge_orders WHERE user_id = ${userId} AND status = 'verified' LIMIT 1`;
  if (orders.length > 0) return true;
  const deposits = await sql`SELECT 1 FROM xrge_bank_txns WHERE user_id = ${userId} AND type = 'deposit' LIMIT 1`;
  return deposits.length > 0;
}

export const LORA_LOCKED_MESSAGE =
  "This LoRA needs the LoRA unlock. Unlock it once for $30 in the app, or hold $XRGE.";
