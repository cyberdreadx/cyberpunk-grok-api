/**
 * /api/creator-applications
 *
 * POST (public)            — submit a new application
 * POST { action: "list" }  — admin: list applications (filter by status)
 * POST { action: "review" }— admin: approve/reject an application
 * POST { action: "mine" }  — logged-in user: get own latest application status
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { buildSystemPrompt } from "./characters";
import { checkRateLimit } from "./_lib/ratelimit";

export const config = {
  maxDuration: 30,
  api: { bodyParser: { sizeLimit: "8mb" } },
};

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

const HANDLE_RE = /^[a-zA-Z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const sql = getDb();
  const auth = getUserFromRequest(req);
  const body = (req.body || {}) as Record<string, any>;
  const action = body.action as string | undefined;

  // ── Admin actions ───────────────────────────────────────────────
  if (action === "list") {
    if (!isAdmin(req)) return res.status(403).json({ error: "Access denied" });
    const status = (body.status as string) || "pending";
    const rows = await sql`
      SELECT id, user_id, email, handle, display_name, country, age_confirmed,
             socials, pitch, niche, languages, sample_urls, payout_pref,
             status, admin_notes, reviewed_at, created_at
      FROM creator_applications
      WHERE status = ${status}
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return res.status(200).json({ applications: rows });
  }

  if (action === "review") {
    if (!isAdmin(req)) return res.status(403).json({ error: "Access denied" });
    const id = body.id as string;
    const decision = body.decision as "approve" | "reject";
    const notes = (body.notes as string) || null;
    if (!id || !["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "id + decision required" });
    }
    const newStatus = decision === "approve" ? "approved" : "rejected";
    const reviewer = auth!.userId;

    const [app] = await sql`
      UPDATE creator_applications
      SET status = ${newStatus}, admin_notes = ${notes},
          reviewed_at = now(), reviewed_by = ${reviewer}::uuid, updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, user_id, status, pitch, sample_urls, display_name, niche, socials
    `;
    if (!app) return res.status(404).json({ error: "Not found" });

    if (decision === "approve" && app.user_id) {
      await sql`
        UPDATE users
        SET is_featured_creator = true, featured_at = COALESCE(featured_at, now())
        WHERE id = ${app.user_id}::uuid
      `;
      // Auto-seed the public profile from the application so the creator shows
      // up with a photo + bio immediately. Only fills blanks — never overwrites
      // an avatar/bio the creator already set. (No-op if no profile row yet.)
      const samples = Array.isArray(app.sample_urls) ? app.sample_urls : [];
      const avatar = samples[0] || null;
      let bio = String(app.pitch || "").trim();
      if (bio.length > 300) {
        bio = bio.slice(0, 297);
        const sp = bio.lastIndexOf(" ");
        bio = (sp > 0 ? bio.slice(0, sp) : bio) + "…";
      }
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT '{}'::jsonb`.catch(() => {});
      const socialsJson = JSON.stringify(app.socials && typeof app.socials === "object" ? app.socials : {});
      await sql`
        UPDATE profiles
        SET avatar_url = COALESCE(NULLIF(avatar_url, ''), ${avatar}),
            bio = CASE WHEN COALESCE(bio, '') = '' THEN ${bio} ELSE bio END,
            socials = CASE WHEN COALESCE(socials::text, '{}') IN ('{}', 'null', '') THEN ${socialsJson}::jsonb ELSE socials END,
            updated_at = now()
        WHERE user_id = ${app.user_id}::uuid
      `;

      // Auto-build the fan-chat persona from the bio so the model never has to
      // create a Character manually, then enable fan chat. Skip if they already
      // linked an official character (don't clobber their own).
      const [u] = await sql`SELECT official_character_id FROM users WHERE id = ${app.user_id}::uuid`;
      if (u && !u.official_character_id) {
        const [prof] = await sql`SELECT username, avatar_url, bio FROM profiles WHERE user_id = ${app.user_id}::uuid`;
        const pname = String(app.display_name || prof?.username || "Creator").slice(0, 100);
        const personality = (String(prof?.bio || "").trim() || `${pname}, a featured creator on GLTCHRunner.`).slice(0, 2000);
        const traits = String(app.niche || "").split(/[,/]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
        const sysPrompt = buildSystemPrompt(pname, personality, traits);
        const [ch] = await sql`
          INSERT INTO characters (user_id, name, portrait_url, personality, traits, system_prompt, llm_backend, is_public, published_at)
          VALUES (${app.user_id}::uuid, ${pname}, ${prof?.avatar_url || null}, ${personality}, ${JSON.stringify(traits)}, ${sysPrompt}, 'deepseek', true, now())
          RETURNING id
        `;
        await sql`
          UPDATE users SET official_character_id = ${ch.id}, creator_persona_chat_enabled = true, updated_at = now()
          WHERE id = ${app.user_id}::uuid
        `;
      } else if (u && u.official_character_id) {
        await sql`UPDATE users SET creator_persona_chat_enabled = true WHERE id = ${app.user_id}::uuid`;
      }
    }
    return res.status(200).json({ ok: true, application: app });
  }

  if (action === "mine") {
    if (!auth) return res.status(401).json({ error: "Not authenticated" });
    const rows = await sql`
      SELECT id, status, created_at, reviewed_at, admin_notes
      FROM creator_applications
      WHERE user_id = ${auth.userId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return res.status(200).json({ application: rows[0] || null });
  }

  // ── Public submission ──────────────────────────────────────────
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit(ip, "creator-apply", { max: 3, windowSeconds: 3600 });
  if (!rl.allowed) return res.status(429).json({ error: "Too many submissions. Try again later." });

  const {
    email, handle, display_name, country, age_confirmed,
    socials, pitch, niche, languages, sample_urls, payout_pref,
  } = body;

  if (!email || !EMAIL_RE.test(String(email))) return res.status(400).json({ error: "Valid email required" });
  if (!handle || !HANDLE_RE.test(String(handle))) {
    return res.status(400).json({ error: "Handle must be 3-24 letters/numbers/underscores" });
  }
  if (!display_name || String(display_name).trim().length < 2) {
    return res.status(400).json({ error: "Display name required" });
  }
  if (!age_confirmed) return res.status(400).json({ error: "You must confirm you are 18+" });
  if (!pitch || String(pitch).trim().length < 30) {
    return res.status(400).json({ error: "Pitch must be at least 30 characters" });
  }
  const samples = Array.isArray(sample_urls) ? sample_urls.filter((u) => typeof u === "string").slice(0, 8) : [];
  const payout = payout_pref === "xrge" ? "xrge" : "stripe";

  // One active pending app per user
  if (auth) {
    const existing = await sql`
      SELECT id FROM creator_applications
      WHERE user_id = ${auth.userId}::uuid AND status = 'pending' LIMIT 1
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: "You already have a pending application" });
    }
  }

  const [row] = await sql`
    INSERT INTO creator_applications
      (user_id, email, handle, display_name, country, age_confirmed,
       socials, pitch, niche, languages, sample_urls, payout_pref)
    VALUES (
      ${auth?.userId || null}::uuid,
      ${String(email).toLowerCase().trim()},
      ${String(handle).trim()},
      ${String(display_name).trim()},
      ${country || null},
      ${!!age_confirmed},
      ${JSON.stringify(socials || {})}::jsonb,
      ${String(pitch).trim()},
      ${niche || null},
      ${languages || null},
      ${JSON.stringify(samples)}::jsonb,
      ${payout}
    )
    RETURNING id, status, created_at
  `;

  return res.status(200).json({ ok: true, application: row });
}
