/**
 * Cron — purge orphaned files in Vercel Blob storage.
 * Weekly full sweep ("0 4 * * 0") + daily `?transient=1` sweep of the
 * generation-input prefixes only (prompts/, uploads/ — privacy-sensitive
 * session uploads that nothing references after the job runs).
 *
 * An "orphan" is any blob no longer referenced by ANY of:
 *   - feed_posts.image_url
 *   - stories.media_url
 *   - profiles.avatar_url
 *   - characters.portrait_url
 *   - notifications.actor_avatar_url   (snapshot URLs from older avatars)
 *   - chat_messages.media_url          (character-chat generated media)
 *   - shares/<id>.json index files (and the media URL each one points to)
 *
 * Safety:
 *   - Blobs uploaded in the last SAFETY_WINDOW_MS are skipped (avoids racing
 *     uploads that haven't been written to the DB yet).
 *   - Defaults to DRY-RUN. The Vercel cron passes `?confirm=1` to actually delete.
 *   - Anyone hitting this endpoint manually without `confirm=1` just gets a report.
 *   - Aborts deletion (returns DRY-RUN) if MORE than ABORT_RATIO of all blobs
 *     would be deleted in a single run — a strong signal that the referenced
 *     set is incomplete (e.g. a new column was added but not registered here).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { requireCronAuth } from "./_lib/cron-auth";

const SAFETY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h grace period
const MAX_DELETIONS_PER_RUN = 5000;           // hard ceiling
const ABORT_RATIO = 0.5;                      // refuse to delete >50% of bucket in one run

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
  if (!requireCronAuth(req, res)) return;
  const token = getBlobToken();
  if (!token) {
    return res.status(503).json({ error: "Blob storage not configured" });
  }

  const confirm = req.query.confirm === "1" || req.query.confirm === "true";
  const verbose = req.query.verbose === "1";
  // transient=1 → sweep ONLY the generation-input prefixes (prompts/, uploads/).
  // Those are session-scoped originals (privacy-sensitive), never share targets,
  // and ~all of them are expected orphans — so this mode skips the share-index
  // resolution and the abort ratio guard. Runs daily; the full sweep stays weekly.
  const transient = req.query.transient === "1" || req.query.transient === "true";
  const TRANSIENT_PREFIXES = ["prompts/", "uploads/"];

  try {
    const sql = getDb();
    const { list, del } = await import("@vercel/blob");

    // ── 1. Build the "referenced" set from the database ─────────────────
    const referenced = new Set<string>();
    const addRef = (u: string | null | undefined) => {
      const p = urlToPathname(u);
      if (p) referenced.add(p);
    };

    const [posts, stories, profiles, characters, notifAvatars, chatMedia] = await Promise.all([
      sql`SELECT image_url FROM feed_posts WHERE image_url IS NOT NULL`.catch(() => []),
      sql`SELECT media_url FROM stories WHERE media_url IS NOT NULL`.catch(() => []),
      sql`SELECT avatar_url FROM profiles WHERE avatar_url IS NOT NULL`.catch(() => []),
      sql`SELECT portrait_url FROM characters WHERE portrait_url IS NOT NULL`.catch(() => []),
      sql`SELECT DISTINCT actor_avatar_url FROM notifications WHERE actor_avatar_url IS NOT NULL`.catch(() => []),
      sql`SELECT DISTINCT media_url FROM chat_messages WHERE media_url IS NOT NULL`.catch(() => []),
    ]);
    for (const r of posts as any[]) addRef(r.image_url);
    for (const r of stories as any[]) addRef(r.media_url);
    for (const r of profiles as any[]) addRef(r.avatar_url);
    for (const r of characters as any[]) addRef(r.portrait_url);
    for (const r of notifAvatars as any[]) addRef(r.actor_avatar_url);
    for (const r of chatMedia as any[]) addRef(r.media_url);

    // ── 2. List blobs (paginate) — whole store, or just transient prefixes ─
    type Blob = { url: string; pathname: string; uploadedAt: Date | string; size: number };
    const allBlobs: Blob[] = [];
    for (const prefix of transient ? TRANSIENT_PREFIXES : [undefined]) {
      let cursor: string | undefined;
      do {
        const page = await list({ token, cursor, limit: 1000, ...(prefix ? { prefix } : {}) });
        allBlobs.push(...(page.blobs as any));
        cursor = page.cursor;
      } while (cursor);
    }

    // ── 3. Resolve share indexes — keep .json + the media each .json points to
    // (skipped in transient mode: generation inputs are never share targets)
    const shareIndexes = transient ? [] : allBlobs.filter(
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

    // ── 5. Safety abort: if we'd delete >50% of the bucket, refuse and force a
    // dry-run report. Not applied in transient mode — transient uploads are
    // SUPPOSED to be ~all orphans once past the safety window.
    const wouldDeleteRatio = allBlobs.length > 0 ? orphans.length / allBlobs.length : 0;
    const aborted = !transient && wouldDeleteRatio > ABORT_RATIO;

    let deleted = 0;
    let failed = 0;
    if (confirm && !aborted && orphans.length > 0) {
      // Throttled batches — 50-wide concurrent deletes tripped Vercel's rate
      // limit (Jul 12 run: 1238 failures). On a 429, wait out the window once.
      const BATCH = 20;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < orphans.length; i += BATCH) {
        const batch = orphans.slice(i, i + BATCH);
        const failedOnce: Blob[] = [];
        await Promise.all(
          batch.map((b) =>
            del(b.url, { token })
              .then(() => { deleted++; })
              .catch((e) => {
                if (/too many requests|rate/i.test(String(e?.message))) failedOnce.push(b);
                else {
                  failed++;
                  console.warn("[cron-blob] delete failed:", b.pathname, e?.message);
                }
              }),
          ),
        );
        if (failedOnce.length > 0) {
          await sleep(61_000);
          await Promise.all(
            failedOnce.map((b) =>
              del(b.url, { token })
                .then(() => { deleted++; })
                .catch((e) => {
                  failed++;
                  console.warn("[cron-blob] delete failed (retry):", b.pathname, e?.message);
                }),
            ),
          );
        }
        await sleep(250);
      }
    }

    const totalSize = orphans.reduce((s, b) => s + (b.size || 0), 0);
    const report = {
      ok: true,
      mode: transient ? "transient" : "full",
      dryRun: !confirm || aborted,
      aborted,
      abortReason: aborted
        ? `Refused to delete ${(wouldDeleteRatio * 100).toFixed(1)}% of bucket — referenced set may be incomplete`
        : null,
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
