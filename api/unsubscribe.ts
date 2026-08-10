/**
 * /api/unsubscribe — one-click opt-out for notification emails.
 *
 * GET  ?token=...  → applies the opt-out and renders a confirmation page.
 * POST ?token=...  → RFC 8058 one-click. Gmail/Yahoo POST here directly from
 *                    their native "Unsubscribe" button, with no cookies and no
 *                    user interaction, and expect a 2xx.
 *
 * Deliberately unauthenticated: the HMAC token IS the proof. Requiring a login
 * to unsubscribe is a CAN-SPAM violation and the single fastest way to convert
 * an annoyed user into a spam complaint.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyUnsubToken, setPrefs, DEFAULT_EMAIL_TYPES } from "./_lib/notification-prefs";

function page(title: string, message: string, ok: boolean): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
</head>
<body style="margin:0;background:#0a0a0f;color:#e0e0e0;font-family:'Courier New',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;">
  <div style="border:1px solid ${ok ? "#00f0ff33" : "#ff004433"};padding:32px;border-radius:4px;max-width:440px;width:100%;">
    <div style="color:#00f0ff;font-size:11px;letter-spacing:3px;margin-bottom:20px;">▌ GLTCH RUNNER</div>
    <div style="color:#fff;font-size:16px;margin-bottom:12px;">${title}</div>
    <div style="color:#a0a0a0;font-size:13px;line-height:1.6;">${message}</div>
    <a href="${process.env.SITE_URL || "https://grokrunner.gltch.app"}/profile"
       style="display:inline-block;margin-top:24px;padding:10px 20px;border:1px solid #00f0ff;color:#00f0ff;text-decoration:none;font-size:12px;letter-spacing:2px;">
       NOTIFICATION SETTINGS</a>
  </div>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = String(req.query.token || (req.body as any)?.token || "");
  const parsed = verifyUnsubToken(token);

  if (!parsed) {
    if (req.method === "POST") return res.status(400).json({ error: "Invalid token" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res
      .status(400)
      .send(page("Link expired or invalid", "That unsubscribe link couldn't be verified. You can change these settings from your profile instead.", false));
  }

  const { userId, type } = parsed;

  try {
    if (type === "*" || !(type in DEFAULT_EMAIL_TYPES)) {
      // Master opt-out.
      await setPrefs(userId, { emailEnabled: false });
    } else {
      // Scoped: turn off just this type, leave the rest alone.
      await setPrefs(userId, { types: { [type]: false } });
    }
  } catch (e: any) {
    console.error("[unsubscribe]", e?.message || e);
    if (req.method === "POST") return res.status(500).json({ error: "Failed" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(page("Something went wrong", "We couldn't apply that just now. Try the settings page.", false));
  }

  // One-click clients want a plain 2xx, not HTML.
  if (req.method === "POST") return res.status(200).json({ ok: true });

  const what =
    type === "*" || !(type in DEFAULT_EMAIL_TYPES)
      ? "All notification emails are now off."
      : `You'll no longer get <strong style="color:#00f0ff">${type}</strong> emails. Your other notification emails are unchanged.`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(page("Unsubscribed", what, true));
}
