/**
 * Weekly cron — purge orphaned files in Vercel Blob storage.
 *
 * An "orphan" is any blob no longer referenced by:
 *   - feed_posts.image_url
 *   - stories.media_url
 *   - profiles.avatar_url
 *   - shares/<id>.json index files (and the media URL each one points to)
 *
 * Safety:
 *   - Blobs uploaded in the last SAFETY_WINDOW_MS are skipped (avoids racing
 *     uploads that haven't been written to the DB yet).
 *   - Defaults to DRY-RUN. The Vercel cron passes `?confirm=1` to actually delete.
 *   - Anyone hitting this endpoint manually without `confirm=1` just gets a report.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";

const SAFETY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h grace period
const MAX_DELETIONS_PER_RUN = 5000;           // hard ceiling

function getBlobToken(): string {
  return (
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.grokrun_READ_WRITE_TOKEN ||
    ""
  );
}

/** Normalize a Vercel Blob URL to its pathname (strip protocol/host/query). */
function urlToPathname(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (!/\.blob\.vercel-storage\.com$/i.test(u.hostname)) return null;
    return decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = getBlobToken();
  if (!token) {
    return res.status(503).json({ error: "Blob storage not configured" });
  }

  const confirm = req.query.confirm === "1" || req.query.confirm === "true";
  const verbose = req.query.verbose === "1";

  try {
    const sql = getDb();
    const { list, del } = await import("@vercel/blob");

    // ── 1. Build the "referenced" set from the database ─────────────────
    const referenced = new Set<string>();
    const addRef = (u: string | null | undefined) => {
      const p = urlToPathname(u);
      if (p) referenced.add(p);
    };

    const [posts, stories, profiles] = await Promise.all([
      sql`SELECT image_url FROM feed_posts WHERE image_url IS NOT NULL`,
      sql`SELECT media_url FROM stories WHERE media_url IS NOT NULL`,
      sql`SELECT avatar_url FROM profiles WHERE avatar_url IS NOT NULL`,
    ]);
    for (const r of posts as any[]) addRef(r.image_url);
    for (const r of stories as any[]) addRef(r.media_url);
    for (const r of profiles as any[]) addRef(r.avatar_url);

    // ── 2. List ALL blobs (paginate) ────────────────────────────────────
    type Blob = { url: string; pathname: string; uploadedAt: Date | string; size: number };
    const allBlobs: Blob[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ token, cursor, limit: 1000 });
      allBlobs.push(...(page.blobs as any));
      cursor = page.cursor;
    } while (cursor);

    // ── 3. Resolve share indexes — keep .json + the media each .json points to
    const shareIndexes = allBlobs.filter(
      (b) => b.pathname.startsWith("shares/") && b.pathname.endsWith(".json"),
    );
    await Promise.all(
      shareIndexes.map(async (idx) => {
        referenced.add(idx.pathname); // keep the .json itself
        try {
          const r = await fetch(idx.url);
          if (!r.ok) return;
          const meta = (await r.json()) as { mediaUrl?: string };
          const p = urlToPathname(meta.mediaUrl);
          if (p) referenced.add(p);
        } catch {
          /* ignore — keep the index either way */
        }
      }),
    );

    // ── 4. Decide what's orphan ─────────────────────────────────────────
    const cutoff = Date.now() - SAFETY_WINDOW_MS;
    const orphans: Blob[] = [];
    for (const b of allBlobs) {
      if (referenced.has(b.pathname)) continue;
      const uploadedAt = new Date(b.uploadedAt).getTime();
      if (Number.isFinite(uploadedAt) && uploadedAt > cutoff) continue; // too fresh
      orphans.push(b);
      if (orphans.length >= MAX_DELETIONS_PER_RUN) break;
    }

    // ── 5. Delete (only if confirmed) ───────────────────────────────────
    let deleted = 0;
    let failed = 0;
    if (confirm && orphans.length > 0) {
      // Batch deletes to avoid hammering the API
      const BATCH = 50;
      for (let i = 0; i < orphans.length; i += BATCH) {
        const batch = orphans.slice(i, i + BATCH);
        await Promise.all(
          batch.map((b) =>
            del(b.url, { token })
              .then(() => { deleted++; })
              .catch((e) => {
                failed++;
                console.warn("[cron-blob] delete failed:", b.pathname, e?.message);
              }),
          ),
        );
      }
    }

    const totalSize = orphans.reduce((s, b) => s + (b.size || 0), 0);
    const report = {
      ok: true,
      dryRun: !confirm,
      totalBlobs: allBlobs.length,
      referenced: referenced.size,
      shareIndexes: shareIndexes.length,
      orphansFound: orphans.length,
      orphanBytes: totalSize,
      deleted,
      failed,
      cappedAt: orphans.length >= MAX_DELETIONS_PER_RUN ? MAX_DELETIONS_PER_RUN : null,
      ...(verbose ? { samples: orphans.slice(0, 50).map((b) => b.pathname) } : {}),
    };

    console.log("[cron-blob-orphans]", JSON.stringify(report));
    return res.status(200).json(report);
  } catch (err: any) {
    console.error("[cron-blob-orphans] error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "cron failed" });
  }
}
