/**
 * Weekly cron — purge orphaned R2 objects under DB-backed prefixes.
 *
 * An "orphan" is an object under a swept prefix that is no longer referenced
 * by the table that owns that prefix:
 *   feed/     → feed_posts.image_url / preview_image_url
 *   stories/  → stories.media_url / preview_url
 *
 * ⚠️ SCOPE IS DELIBERATELY LIMITED to those two prefixes. gltch/, seedance/
 * and other generation-output prefixes hold library media referenced ONLY
 * from users' local IndexedDB — the DB knows nothing about them, so a
 * reference-based sweep there would wipe user libraries. Never widen the
 * scope to a prefix whose references don't live in Postgres.
 *
 * Safety:
 *   - Objects modified in the last SAFETY_WINDOW_MS are skipped (upload→DB
 *     write races; also keeps live 24h stories clear of any edge case).
 *   - Defaults to DRY-RUN; deletion requires `?confirm=1`.
 *   - The whole endpoint requires the CRON_SECRET bearer token (cron-auth).
 *   - feed/ deletion aborts (falls back to dry-run) if the DB scan finds no
 *     references or if >FEED_ABORT_RATIO of listed objects look orphaned —
 *     both are signals the reference query is broken, not the bucket.
 *     stories/ has no ratio guard: expired stories SHOULD be ~all orphans.
 *   - Hard ceiling of MAX_DELETIONS_PER_RUN per invocation.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { deleteR2Objects, isR2Url, listR2Objects, r2KeyFromUrl } from "./_lib/r2";
import { previewKeyForKey } from "./_lib/preview-url";
import { requireCronAuth } from "./_lib/cron-auth";

const SAFETY_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_DELETIONS_PER_RUN = 5000;
const FEED_ABORT_RATIO = 0.9;

type PrefixReport = {
  prefix: string;
  listed: number;
  referenced: number;
  fresh: number;
  orphans: number;
  deleted: number;
  aborted?: string;
  sampleOrphans?: string[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronAuth(req, res)) return;
  const confirm = req.query.confirm === "1" || req.query.confirm === "true";
  const verbose = req.query.verbose === "1";

  try {
    const sql = getDb();

    // Build the referenced-key set per owning table. Any query failure
    // throws → whole run fails closed with a 500, nothing gets deleted.
    const addRef = (set: Set<string>, url: unknown) => {
      if (typeof url !== "string" || !url || !isR2Url(url)) return;
      const key = r2KeyFromUrl(url);
      if (!key) return;
      set.add(key);
      if (!key.endsWith("-preview.webp")) set.add(previewKeyForKey(key));
    };

    // Union of every table that can hold a media URL (mirrors the blob-orphan
    // cron's reference list) — an object is only an orphan if NOTHING points
    // at it, in case a feed/story URL was reused as an avatar/portrait/etc.
    const refs = new Set<string>();
    let feedRefCount = 0;
    for (const r of await sql`SELECT image_url, preview_image_url FROM feed_posts`) {
      if (r.image_url) feedRefCount++;
      addRef(refs, r.image_url);
      addRef(refs, r.preview_image_url);
    }
    for (const r of await sql`SELECT media_url, preview_url FROM stories`) {
      addRef(refs, r.media_url);
      addRef(refs, r.preview_url);
    }
    for (const r of await sql`SELECT avatar_url FROM profiles WHERE avatar_url IS NOT NULL`) addRef(refs, r.avatar_url);
    for (const r of await sql`SELECT portrait_url FROM characters WHERE portrait_url IS NOT NULL`) addRef(refs, r.portrait_url);
    for (const r of await sql`SELECT DISTINCT actor_avatar_url FROM notifications WHERE actor_avatar_url IS NOT NULL`) addRef(refs, r.actor_avatar_url);

    const plans: Array<{ prefix: string; refs: Set<string>; ratioGuard: boolean }> = [
      { prefix: "feed/", refs, ratioGuard: true },
      { prefix: "stories/", refs, ratioGuard: false },
    ];

    const now = Date.now();
    let deletionBudget = MAX_DELETIONS_PER_RUN;
    const reports: PrefixReport[] = [];

    for (const plan of plans) {
      const objects = await listR2Objects(plan.prefix);
      const report: PrefixReport = {
        prefix: plan.prefix,
        listed: objects.length,
        referenced: 0,
        fresh: 0,
        orphans: 0,
        deleted: 0,
      };

      const orphanKeys: string[] = [];
      for (const obj of objects) {
        if (plan.refs.has(obj.key)) { report.referenced++; continue; }
        const age = obj.lastModified ? now - obj.lastModified.getTime() : 0;
        if (!obj.lastModified || age < SAFETY_WINDOW_MS) { report.fresh++; continue; }
        orphanKeys.push(obj.key);
      }
      report.orphans = orphanKeys.length;
      if (verbose) report.sampleOrphans = orphanKeys.slice(0, 25);

      let effectiveConfirm = confirm;
      if (plan.ratioGuard && orphanKeys.length > 0) {
        if (feedRefCount === 0) {
          report.aborted = "no feed_posts references found — reference query looks broken";
          effectiveConfirm = false;
        } else if (objects.length > 0 && orphanKeys.length / objects.length > FEED_ABORT_RATIO) {
          report.aborted = `orphan ratio ${(orphanKeys.length / objects.length).toFixed(2)} exceeds ${FEED_ABORT_RATIO}`;
          effectiveConfirm = false;
        }
      }

      if (effectiveConfirm && orphanKeys.length > 0 && deletionBudget > 0) {
        const batch = orphanKeys.slice(0, deletionBudget);
        const tally = await deleteR2Objects(batch);
        report.deleted = tally.deleted;
        deletionBudget -= batch.length;
      }

      reports.push(report);
    }

    const summary = {
      ok: true,
      dryRun: !confirm,
      budgetRemaining: deletionBudget,
      reports,
    };
    console.log("[cron-r2-orphans]", JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err: any) {
    console.error("[cron-r2-orphans]", err?.message || err);
    return res.status(500).json({ error: err?.message || "sweep failed" });
  }
}
