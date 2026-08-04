import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { uploadPublicMedia } from "./_lib/media-storage";
import { fetchShareMetadata } from "./_lib/share-metadata";
import { deleteBlobs, isVercelBlobUrl } from "./_lib/blob";
import { deleteR2Objects, isR2Url, r2KeyFromUrl } from "./_lib/r2";

export const config = { maxDuration: 60 };

const SHARE_ID_RE = /^[a-zA-Z0-9_-]{4,16}$/;

/**
 * Hosts we will fetch media from when a share is created by URL. Mirrors the
 * allowlist in api/download.ts: our own storage plus the generation providers.
 * Anything else is refused rather than proxied into the public bucket.
 */
const SHARE_FETCH_DOMAINS = [
  "vidgen.x.ai", "api.x.ai", "cdn.x.ai",
  "r2.cloudflarestorage.com",
  "vercel-storage.com",
  "runpod.io",
  "gltch.app",
  "fal.media", "fal.ai",
];

function isAllowedMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc|fd|fe80|localhost)/i.test(h)) {
    return false;
  }
  if (/^pub-[a-z0-9]+\.r2\.dev$/.test(h)) return true;
  return SHARE_FETCH_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

function getBlobToken(): string {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
}

/** Remove a share's storage objects (R2 + Blob) and its ownership row. */
async function destroyShare(sql: any, shareId: string): Promise<void> {
  const token = getBlobToken();
  const meta = await fetchShareMetadata(shareId);
  const keysToDelete: string[] = [`shares/${shareId}.json`];
  if (meta?.ext) keysToDelete.push(`shares/${shareId}.${meta.ext}`);
  if (meta?.mediaUrl && isR2Url(String(meta.mediaUrl))) {
    const k = r2KeyFromUrl(String(meta.mediaUrl));
    if (k) keysToDelete.push(k);
  }

  await deleteR2Objects(keysToDelete).catch(() => {});

  if (token) {
    const { list, del } = await import("@vercel/blob");
    // dot-terminated so a share id that prefixes a longer id can't over-match
    const { blobs } = await list({ prefix: `shares/${shareId}.`, token });
    await Promise.all(
      blobs.map((b) =>
        del(b.url, { token }).catch((err) => console.warn("[share] blob del failed:", err?.message)),
      ),
    );
  } else if (meta?.mediaUrl && isVercelBlobUrl(String(meta.mediaUrl))) {
    await deleteBlobs([String(meta.mediaUrl)]);
  }
  await sql`DELETE FROM share_owners WHERE share_id = ${shareId}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ---------------------------------------------------------------- POST
  if (req.method === "POST") {
    try {
      const auth = getUserFromRequest(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const { mediaBase64, mediaUrl, mediaType, prompt } = req.body || {};
      if (!mediaType || (!mediaBase64 && !mediaUrl)) {
        return res.status(400).json({ error: "mediaType and either mediaBase64 or mediaUrl required" });
      }

      let buffer: Buffer;

      if (mediaUrl) {
        const urlObj = new URL(mediaUrl);
        if (!["https:"].includes(urlObj.protocol)) {
          return res.status(400).json({ error: "Only HTTPS URLs allowed" });
        }
        // SSRF guard: without a host allowlist this fetched ANY url the caller
        // named and published the response body to a public URL — including
        // internal services (the API itself listens on 127.0.0.1:3000) and
        // cloud metadata. redirect:"error" stops an allowlisted host from
        // bouncing us somewhere private.
        if (!isAllowedMediaHost(urlObj.hostname)) {
          return res.status(400).json({ error: "Media URL host not allowed" });
        }
        const dlResp = await fetch(mediaUrl, { signal: AbortSignal.timeout(25000), redirect: "error" }).catch(() => null);
        if (!dlResp || !dlResp.ok) {
          return res.status(502).json({ error: `Failed to download media (${dlResp?.status ?? "fetch failed"})` });
        }
        const declaredLength = Number(dlResp.headers.get("content-length") || 0);
        if (declaredLength > 50 * 1024 * 1024) {
          return res.status(413).json({ error: "File too large (max 50MB)" });
        }
        const arrayBuf = await dlResp.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      } else {
        const raw = mediaBase64.includes(",") ? mediaBase64.split(",")[1] : mediaBase64;
        buffer = Buffer.from(raw, "base64");
      }

      if (buffer.length > 50 * 1024 * 1024) {
        return res.status(413).json({ error: "File too large (max 50MB)" });
      }

      const shareId = crypto.randomBytes(6).toString("base64url").slice(0, 8);
      const ext = mediaType.includes("video") ? "mp4" : mediaType.includes("jpeg") ? "jpg" : "png";
      // Allowlist the stored Content-Type. Passing any "image/*" through meant
      // image/svg+xml could be stored in the PUBLIC bucket and later served
      // back (via /api/share-image and /api/download) as executable markup —
      // stored XSS under our own domain. Unknown types degrade to PNG.
      const SAFE_SHARE_TYPES = new Set([
        "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif",
      ]);
      const requestedType = String(mediaType).split(";")[0].trim().toLowerCase();
      const contentType = requestedType.startsWith("video")
        ? "video/mp4"
        : SAFE_SHARE_TYPES.has(requestedType) ? requestedType : "image/png";

      const mediaUpload = await uploadPublicMedia(
        buffer,
        `shares/${shareId}.${ext}`,
        contentType,
      );

      const metadata = JSON.stringify({
        mediaUrl: mediaUpload.url,
        mediaType: mediaType.startsWith("video") ? "video" : "image",
        prompt: prompt || "",
        createdAt: new Date().toISOString(),
        userId: auth.userId,
        ext,
        storage: mediaUpload.storage,
      });

      await uploadPublicMedia(
        Buffer.from(metadata, "utf8"),
        `shares/${shareId}.json`,
        "application/json",
      );

      const siteUrl = (process.env.SITE_URL || "https://grokrunner.gltch.app").replace(/\/$/, "");

      // Persist ownership + log share for daily missions.
      // Anti-farming: hash the media so re-sharing identical content logs as
      // 'share-repeat', which does NOT satisfy the daily share mission
      // (daily-missions.ts only counts mode='share'). Top farmers were claiming
      // 10 cr/day for months by re-sharing the same story.
      try {
        const { getDb } = await import("./_lib/db");
        const sql = getDb();
        await sql`
          INSERT INTO share_owners (share_id, user_id, ext)
          VALUES (${shareId}, ${auth.userId}::uuid, ${ext})
          ON CONFLICT (share_id) DO NOTHING
        `;
        const mediaHash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 24);
        const [prior] = await sql`
          SELECT id FROM usage_log
          WHERE user_id = ${auth.userId}::uuid
            AND mode IN ('share', 'share-repeat')
            AND prompt LIKE ${"%#" + mediaHash}
          LIMIT 1
        `;
        const logMode = prior ? "share-repeat" : "share";
        await sql`
          INSERT INTO usage_log (user_id, mode, credits_used, prompt)
          VALUES (${auth.userId}::uuid, ${logMode}, 0, ${`shared:${shareId}#${mediaHash}`})
        `;
      } catch (e) {
        console.warn("[share] ownership/log insert failed:", (e as any)?.message);
      }

      return res.status(200).json({
        shareId,
        shareUrl: `${siteUrl}/s/${shareId}`,
        r2Url: mediaUpload.url,
        url: mediaUpload.url,
      });
    } catch (err: any) {
      console.error("[share] POST error:", err.message);
      return res.status(500).json({ error: "Failed to create share" });
    }
  }

  // ---------------------------------------------------------------- DELETE
  if (req.method === "DELETE") {
    try {
      const auth = getUserFromRequest(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });
      const shareId = (req.query.id as string) || "";
      const { getDb } = await import("./_lib/db");
      const sql = getDb();

      // Bulk revoke: DELETE /api/share?id=all wipes every share the caller owns.
      if (shareId === "all") {
        const rows = await sql`SELECT share_id FROM share_owners WHERE user_id = ${auth.userId}::uuid`;
        let deleted = 0;
        for (const row of rows as any[]) {
          try {
            await destroyShare(sql, row.share_id);
            deleted++;
          } catch (e: any) {
            console.warn("[share] bulk revoke failed for", row.share_id, e?.message);
          }
        }
        return res.status(200).json({ deleted });
      }

      if (!SHARE_ID_RE.test(shareId)) return res.status(400).json({ error: "Invalid share ID" });

      const rows = await sql`SELECT user_id FROM share_owners WHERE share_id = ${shareId} LIMIT 1`;
      const isAdmin = auth.email === ADMIN_EMAIL;
      const owns = rows.length > 0 && rows[0].user_id === auth.userId;
      if (!owns && !isAdmin) return res.status(403).json({ error: "Forbidden" });

      await destroyShare(sql, shareId);
      return res.status(200).json({ deleted: true });
    } catch (err: any) {
      console.error("[share] DELETE error:", err.message);
      return res.status(500).json({ error: "Failed to delete share" });
    }
  }

  // ---------------------------------------------------------------- GET
  if (req.method === "GET") {
    // List the caller's own active share links (server-side truth — works
    // across browsers/devices, unlike the local share-link map).
    if ((req.query.action as string) === "mine") {
      try {
        const auth = getUserFromRequest(req);
        if (!auth) return res.status(401).json({ error: "Unauthorized" });
        const { getDb } = await import("./_lib/db");
        const sql = getDb();
        const rows = await sql`
          SELECT share_id, ext, created_at
          FROM share_owners
          WHERE user_id = ${auth.userId}::uuid
          ORDER BY created_at DESC NULLS LAST
          LIMIT 500
        `;
        const siteUrl = (process.env.SITE_URL || "https://grokrunner.gltch.app").replace(/\/$/, "");
        return res.status(200).json({
          shares: (rows as any[]).map((r) => ({
            shareId: r.share_id,
            shareUrl: `${siteUrl}/s/${r.share_id}`,
            mediaType: r.ext === "mp4" ? "video" : "image",
            createdAt: r.created_at,
          })),
        });
      } catch (err: any) {
        console.error("[share] mine error:", err.message);
        return res.status(500).json({ error: "Failed to list shares" });
      }
    }

    // Admin-triggered backfill action: scans shares/*.json for embedded userId
    // and inserts missing share_owners rows. Safe to re-run.
    if ((req.query.action as string) === "backfill-owners") {
      try {
        const auth = getUserFromRequest(req);
        if (!auth || auth.email !== ADMIN_EMAIL) {
          return res.status(403).json({ error: "Admin only" });
        }
        const token = getBlobToken();
        if (!token) return res.status(503).json({ error: "Blob storage not configured" });

        const { getDb } = await import("./_lib/db");
        const sql = getDb();
        const { list } = await import("@vercel/blob");

        let cursor: string | undefined;
        let scanned = 0;
        let inserted = 0;
        let skipped = 0;
        let unattributed = 0;
        const errors: string[] = [];

        do {
          const page: any = await list({ prefix: "shares/", token, cursor, limit: 1000 });
          cursor = page.cursor;
          const jsonBlobs = (page.blobs || []).filter((b: any) => b.pathname.endsWith(".json"));

          await Promise.all(
            jsonBlobs.map(async (b: any) => {
              scanned++;
              const m = b.pathname.match(/^shares\/([^.]+)\.json$/);
              if (!m) return;
              const shareId = m[1];
              try {
                const resp = await fetch(b.url, { signal: AbortSignal.timeout(8000) });
                if (!resp.ok) { errors.push(`fetch ${shareId}: ${resp.status}`); return; }
                const meta = await resp.json();
                const userId = meta?.userId;
                const ext = meta?.ext || (meta?.mediaType === "video" ? "mp4" : "png");
                if (!userId) { unattributed++; return; }
                const r = await sql`
                  INSERT INTO share_owners (share_id, user_id, ext)
                  VALUES (${shareId}, ${userId}::uuid, ${ext})
                  ON CONFLICT (share_id) DO NOTHING
                  RETURNING share_id
                `;
                if (r.length > 0) inserted++; else skipped++;
              } catch (e: any) {
                errors.push(`${shareId}: ${e?.message || e}`);
              }
            }),
          );
        } while (cursor);

        return res.status(200).json({
          scanned, inserted, skipped, unattributed,
          errorCount: errors.length,
          errors: errors.slice(0, 20),
        });
      } catch (err: any) {
        console.error("[share] backfill error:", err.message);
        return res.status(500).json({ error: "Backfill failed", message: err.message });
      }
    }

    // Default GET: resolve a share's metadata for the public landing page.
    try {
      const shareId = req.query.id as string;
      if (!shareId || !SHARE_ID_RE.test(shareId)) {
        return res.status(400).json({ error: "Invalid share ID" });
      }

      const meta = await fetchShareMetadata(shareId);
      if (!meta) return res.status(404).json({ error: "Share not found" });

      return res.status(200).json({
        r2Url: meta.mediaUrl,
        mediaType: meta.mediaType,
        prompt: meta.prompt,
        createdAt: meta.createdAt,
      });
    } catch (err: any) {
      console.error("[share] GET error:", err.message);
      return res.status(500).json({ error: "Failed to retrieve share" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
