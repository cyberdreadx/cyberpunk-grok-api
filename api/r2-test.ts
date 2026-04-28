/**
 * Admin-only R2 connectivity test.
 * GET /api/r2-test
 *
 * Verifies:
 *  1. All required R2 env vars are set
 *  2. uploadToR2 succeeds
 *  3. Public URL is reachable from the open internet (no auth)
 *
 * Returns JSON with each step's status so you can see exactly where it fails.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { verifyToken } from "./_lib/auth";
import { uploadToR2, getPublicUrl } from "./_lib/r2";
import { sql } from "./_lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Admin gate
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const auth = verifyToken(token);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  try {
    const rows = await sql`SELECT is_admin FROM users WHERE id = ${auth.userId} LIMIT 1`;
    if (!rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });
  } catch (e: any) {
    return res.status(500).json({ error: "DB check failed", detail: e?.message });
  }

  const env = {
    R2_ACCOUNT_ID: !!process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: !!process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: !!process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || "(default: grokker-media)",
    R2_PUBLIC_BUCKET_URL: process.env.R2_PUBLIC_BUCKET_URL || null,
    R2_PUBLIC_DOMAIN: process.env.R2_PUBLIC_DOMAIN || null,
  };

  const missing: string[] = [];
  if (!env.R2_ACCOUNT_ID) missing.push("R2_ACCOUNT_ID");
  if (!env.R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (!env.R2_PUBLIC_BUCKET_URL && !env.R2_PUBLIC_DOMAIN) {
    missing.push("R2_PUBLIC_BUCKET_URL or R2_PUBLIC_DOMAIN");
  }
  if (missing.length) {
    return res.status(500).json({ ok: false, step: "env-check", missing, env });
  }

  // 1) Upload a small test file
  const key = `r2-test/${Date.now()}-ping.txt`;
  const body = Buffer.from(`r2 ping @ ${new Date().toISOString()}`);
  try {
    await uploadToR2(key, body, "text/plain");
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      step: "upload",
      error: e?.message || String(e),
      env,
    });
  }

  // 2) Resolve public URL
  const publicUrl = getPublicUrl(key);
  if (!publicUrl) {
    return res.status(500).json({
      ok: false,
      step: "public-url",
      error: "getPublicUrl returned empty — set R2_PUBLIC_BUCKET_URL or R2_PUBLIC_DOMAIN",
      env,
    });
  }

  // 3) Fetch it back over the public internet
  let fetchStatus: number | null = null;
  let fetchBody: string | null = null;
  try {
    const r = await fetch(publicUrl);
    fetchStatus = r.status;
    fetchBody = (await r.text()).slice(0, 200);
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        step: "public-fetch",
        publicUrl,
        fetchStatus,
        fetchBody,
        hint: "Bucket likely not public — enable public access in Cloudflare R2 settings, or check R2_PUBLIC_BUCKET_URL.",
        env,
      });
    }
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      step: "public-fetch",
      publicUrl,
      error: e?.message || String(e),
      env,
    });
  }

  return res.status(200).json({
    ok: true,
    publicUrl,
    fetchStatus,
    bodyPreview: fetchBody,
    env,
    message: "R2 is fully working — upload, public URL, and public fetch all succeeded.",
  });
}
