/**
 * /api/notification-prefs — read/update a user's email notification settings.
 *
 * GET   → { emailEnabled, types: { comment: true, ... } }
 * PATCH → { emailEnabled?: boolean, types?: { comment?: boolean, ... } }
 *
 * The unsubscribe LINK in emails is stateless and unauthenticated (see
 * api/unsubscribe.ts); this is the in-app counterpart.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { getPrefs, setPrefs, DEFAULT_EMAIL_TYPES } from "./_lib/notification-prefs";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (req.method === "GET") {
      const prefs = await getPrefs(auth.userId);
      return res.status(200).json({ ...prefs, available: Object.keys(DEFAULT_EMAIL_TYPES) });
    }

    if (req.method === "PATCH") {
      const body = (req.body || {}) as { emailEnabled?: boolean; types?: Record<string, boolean> };
      if (body.emailEnabled === undefined && !body.types) {
        return res.status(400).json({ error: "Nothing to update" });
      }
      // setPrefs filters `types` down to known keys before writing.
      await setPrefs(auth.userId, {
        emailEnabled: typeof body.emailEnabled === "boolean" ? body.emailEnabled : undefined,
        types: body.types,
      });
      const prefs = await getPrefs(auth.userId);
      return res.status(200).json({ ...prefs, available: Object.keys(DEFAULT_EMAIL_TYPES) });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: any) {
    console.error("[notification-prefs]", e?.message || e);
    return res.status(500).json({ error: "Failed to load notification settings" });
  }
}
