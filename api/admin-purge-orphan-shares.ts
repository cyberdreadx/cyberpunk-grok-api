/**
 * One-shot admin backfill — purge orphaned `shares/` blobs whose
 * `share_owners` row no longer exists (e.g. the owning account was deleted
 * before the share-cleanup helpers existed).
 *
 * Usage (admin JWT required):
 *   GET  /api/admin-purge-orphan-shares                 → dry-run report
 *   GET  /api/admin-purge-orphan-shares?confirm=1       → actually delete
 *   GET  /api/admin-purge-orphan-shares?verbose=1       → include sample paths
 *
 * Safety:
 *   - Dry-run by default. Pass ?confirm=1 to delete.
 *   - Skips blobs uploaded in the last 24h (avoids racing in-flight shares
 *     that haven't written their `share_owners` row yet).
 *   - Aborts deletion if it would remove more than 80% of `shares/` blobs
 *     (a strong signal the DB lookup is broken).
 *   - Caps deletions at 5000 per run.
 *
 * Blob layout (see api/share.ts):
 *   shares/<shareId>.json         -- metadata index
 *   shares/<shareId>.<ext>        -- the underlying media (png, jpg, mp4, …)
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { recordPurge } from "./_lib/purgeLog";

const SAFETY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_DELETIONS_PER_RUN = 5000;
const ABORT_RATIO = 0.8;

function getBlobToken(): string {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
}

/** `shares/abc123.png` → `abc123` (also handles `.json` indexes). */
function shareIdFromPathname(pathname: string): string | null {
  if (!pathname.startsWith("shares/")) return null;
  const tail = pathname.slice("shares/".length);
  const dot = tail.lastIndexOf(".");
  const id = dot >= 0 ? tail.slice(0, dot) : tail;
  return id || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Admin-only
  const auth = getUserFromRequest(req);
  if (!auth || auth.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const token = getBlobToken();
  if (!token) return res.status(503).json({ error: "Blob storage not configured" });

  const confirm = req.query.confirm === "1" || req.query.confirm === "true";
  const verbose = req.query.verbose === "1";

  try {
    const sql = getDb();
    const { list, del } = await import("@vercel/blob");

    // 1. List every blob under the shares/ prefix
    type Blob = { url: string; pathname: string; uploadedAt: Date | string; size: number };
    const allShares: Blob[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ token, cursor, limit: 1000, prefix: "shares/" });
      allShares.push(...(page.blobs as any));
      cursor = page.cursor;
    } while (cursor);

    // 2. Collect distinct share ids from the bucket
    const idsInBucket = new Set<string>();
    for (const b of allShares) {
      const id = shareIdFromPathname(b.pathname);
      if (id) idsInBucket.add(id);
    }

    // 3. Look up which share ids still have an owner row (chunked IN-list)
    const knownIds = new Set<string>();
    const idArr = Array.from(idsInBucket);
    const CHUNK = 500;
    for (let i = 0; i < idArr.length; i += CHUNK) {
      const chunk = idArr.slice(i, i + CHUNK);
      try {
        const rows = await sql`SELECT share_id FROM share_owners WHERE share_id = ANY(${chunk})`;
        for (const r of rows as any[]) knownIds.add(r.share_id);
      } catch (e: any) {
        return res.status(500).json({ error: "share_owners lookup failed", detail: e?.message });
      }
    }

    // 4. Decide orphans
    const cutoff = Date.now() - SAFETY_WINDOW_MS;
    const orphans: Blob[] = [];
    for (const b of allShares) {
      const id = shareIdFromPathname(b.pathname);
      if (!id) continue;
      if (knownIds.has(id)) continue;
      const uploadedAt = new Date(b.uploadedAt).getTime();
      if (Number.isFinite(uploadedAt) && uploadedAt > cutoff) continue;
      orphans.push(b);
      if (orphans.length >= MAX_DELETIONS_PER_RUN) break;
    }

    // 5. Safety abort
    const ratio = allShares.length > 0 ? orphans.length / allShares.length : 0;
    const aborted = ratio > ABORT_RATIO;

    let deleted = 0;
    let failed = 0;
    if (confirm && !aborted && orphans.length > 0) {
      const BATCH = 50;
      for (let i = 0; i < orphans.length; i += BATCH) {
        const batch = orphans.slice(i, i + BATCH);
        await Promise.all(
          batch.map((b) =>
            del(b.url, { token })
              .then(() => { deleted++; })
              .catch((e) => { failed++; console.warn("[purge-shares] delete failed:", b.pathname, e?.message); }),
          ),
        );
      }
    }

    const totalSize = orphans.reduce((s, b) => s + (b.size || 0), 0);
    const report = {
      ok: true,
      dryRun: !confirm || aborted,
      aborted,
      abortReason: aborted
        ? `Refused to delete ${(ratio * 100).toFixed(1)}% of shares/ — share_owners lookup may be incomplete`
        : null,
      shareBlobs: allShares.length,
      distinctShareIds: idsInBucket.size,
      ownedShareIds: knownIds.size,
      orphansFound: orphans.length,
      orphanBytes: totalSize,
      deleted,
      failed,
      cappedAt: orphans.length >= MAX_DELETIONS_PER_RUN ? MAX_DELETIONS_PER_RUN : null,
      ...(verbose ? { samples: orphans.slice(0, 50).map((b) => b.pathname) } : {}),
    };

    console.log("[admin-purge-orphan-shares]", JSON.stringify(report));
    return res.status(200).json(report);
  } catch (err: any) {
    console.error("[admin-purge-orphan-shares] error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "purge failed" });
  }
}
