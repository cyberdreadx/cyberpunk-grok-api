/**
 * /api/cron-media-integrity — does every stored media URL still resolve?
 *
 * On 2026-09-23 a user reported "download button not working on videos". The
 * button was fine: revoking a share had been deleting the shared file itself
 * (fixed in d76efff), and 60 of 191 video downloads were 404ing against media
 * that no longer existed. Nobody knew until someone complained, and by then the
 * files were unrecoverable — R2 has no versioning, and adding retention would
 * break the promise that deleting means deleted.
 *
 * So this is the compromise: we cannot undo a bad delete, but we can notice one
 * the same day. Every feed post, story, avatar and character portrait is checked
 * against storage; anything newly missing is posted to Discord.
 *
 * Read-only. It deletes nothing and fixes nothing — a broken reference is
 * usually a real bug, and repairing it automatically would hide the bug.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { requireCronAuth } from "./_lib/cron-auth";
import { isR2Url } from "./_lib/r2";
import { isVercelBlobUrl } from "./_lib/blob";

const STATE_KEY = "media_integrity";
const CONCURRENCY = 12;
const TIMEOUT_MS = 8000;

interface Target { surface: string; id: string; owner: string | null; url: string; field: string }
interface Broken extends Target { status: number | string }

/**
 * HEAD, then a 1-byte GET if the host dislikes HEAD. One retry on a network
 * error: a flaky socket must never be reported as lost media.
 */
async function probe(url: string): Promise<number | string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        let r = await fetch(url, { method: "HEAD", signal: ctrl.signal });
        if (r.status === 405 || r.status === 501) {
          r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: ctrl.signal });
        }
        return r.ok ? 200 : r.status;
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      if (attempt === 1) return err?.name === "AbortError" ? "timeout" : "unreachable";
    }
  }
  return "unreachable";
}

async function probeAll(targets: Target[]): Promise<Broken[]> {
  const broken: Broken[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      const status = await probe(t.url);
      if (status !== 200) broken.push({ ...t, status });
    }
  });
  await Promise.all(workers);
  return broken;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronAuth(req, res)) return;
  const sql = getDb();
  const started = Date.now();

  try {
    const targets: Target[] = [];
    const add = (surface: string, id: string, owner: string | null, field: string, url: unknown) => {
      if (typeof url !== "string" || !url) return;
      if (!isR2Url(url) && !isVercelBlobUrl(url)) return; // only what we host
      targets.push({ surface, id: String(id), owner: owner ? String(owner) : null, url, field });
    };

    for (const r of (await sql`SELECT id, user_id, image_url, preview_image_url FROM feed_posts`) as any[]) {
      add("feed", r.id, r.user_id, "image_url", r.image_url);
      add("feed", r.id, r.user_id, "preview_image_url", r.preview_image_url);
    }
    for (const r of (await sql`SELECT id, user_id, media_url, preview_url FROM stories`) as any[]) {
      add("story", r.id, r.user_id, "media_url", r.media_url);
      add("story", r.id, r.user_id, "preview_url", r.preview_url);
    }
    for (const r of (await sql`SELECT user_id, avatar_url FROM profiles WHERE avatar_url IS NOT NULL`) as any[]) {
      add("avatar", r.user_id, r.user_id, "avatar_url", r.avatar_url);
    }
    for (const r of (await sql`SELECT id, portrait_url FROM characters WHERE portrait_url IS NOT NULL`) as any[]) {
      add("character", r.id, null, "portrait_url", r.portrait_url);
    }

    const broken = await probeAll(targets);

    // Only NEW breakage is worth waking anyone for. The rest is already known.
    const prevRows = (await sql`SELECT value FROM app_config WHERE key = ${STATE_KEY} LIMIT 1`) as any[];
    const prev: string[] = Array.isArray(prevRows[0]?.value?.broken) ? prevRows[0].value.broken : [];
    const prevSet = new Set(prev);
    const key = (b: Broken) => `${b.surface}:${b.id}:${b.field}`;
    const nowKeys = broken.map(key);
    const fresh = broken.filter((b) => !prevSet.has(key(b)));

    await sql`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (${STATE_KEY}, ${JSON.stringify({
        checked: targets.length,
        broken: nowKeys,
        lastRun: new Date().toISOString(),
      })}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;

    // ?quiet=1 records the state without alerting. Used to seed the first
    // baseline (where everything broken is "new") and for manual runs.
    const quiet = req.query.quiet === "1" || req.query.quiet === "true";

    if (fresh.length > 0 && !quiet && process.env.DISCORD_ALERT_WEBHOOK) {
      const bySurface = fresh.reduce((a: Record<string, number>, b) => {
        a[b.surface] = (a[b.surface] ?? 0) + 1; return a;
      }, {});
      const sample = fresh.slice(0, 6).map((b) => `• ${b.surface} \`${b.id.slice(0, 8)}\` ${b.field} → ${b.status}`).join("\n");
      await fetch(process.env.DISCORD_ALERT_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "GLTCH Ops",
          embeds: [{
            title: `⚠️ ${fresh.length} media file${fresh.length === 1 ? "" : "s"} went missing`,
            description:
              `${Object.entries(bySurface).map(([k, v]) => `**${v}** ${k}`).join(" · ")}\n\n${sample}` +
              `\n\nChecked ${targets.length} files. A file vanishing usually means a deletion path removed something another surface still points at.`,
            color: 0xfbbf24,
            footer: { text: "gltch ops · cron-media-integrity" },
            timestamp: new Date().toISOString(),
          }],
        }),
      }).catch((e: any) => console.error("[media-integrity] discord:", e?.message));
    }

    console.log(`[cron-media-integrity] checked ${targets.length}, broken ${broken.length} (${fresh.length} new) in ${Math.round((Date.now() - started) / 1000)}s`);
    return res.status(200).json({
      ok: true,
      checked: targets.length,
      broken: broken.length,
      newlyBroken: fresh.length,
      seconds: Math.round((Date.now() - started) / 1000),
      ...(req.query.verbose ? { detail: broken.slice(0, 50) } : {}),
    });
  } catch (err: any) {
    console.error("[cron-media-integrity]", err?.message);
    return res.status(500).json({ error: err?.message || "integrity check failed" });
  }
}
