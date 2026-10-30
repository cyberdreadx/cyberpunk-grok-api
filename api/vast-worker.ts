/**
 * /api/vast-worker — the only door a Vast.ai GPU machine has into GLTCH.
 *
 * Machines PULL work here over HTTPS (see api/_lib/vast.ts for the design).
 * Auth is a per-machine token minted when the scaler rents it
 * (label.HMAC(VAST_WORKER_SECRET, label)); a destroyed machine's token stops
 * working at once because its row is checked on every call.
 *
 * POST { action: "manifest" }               → { models: [{ path, url, size }] } (signed, 6h)
 * POST { action: "ready" }                  → machine finished booting
 * POST { action: "next" }                   → { job: { id, input } | null } (long-polls ~20s)
 * POST { action: "result", id, output|error }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getDownloadUrl } from "./_lib/r2";
import {
  claimVastJob, ensureVastTables, finishVastJob, verifyWorkerToken, type PoolName,
} from "./_lib/vast";

const SAFE_JOB_RE = /^vast-[0-9a-f-]{36}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const auth = String(req.headers.authorization || "");
  const label = auth.startsWith("Bearer ") ? verifyWorkerToken(auth.slice(7).trim()) : null;
  if (!label) return res.status(401).json({ error: "bad token" });

  await ensureVastTables();
  const sql = getDb();
  const rows = (await sql`SELECT pool, status FROM vast_instances WHERE label = ${label} AND destroyed_at IS NULL`) as any[];
  if (!rows.length) return res.status(410).json({ error: "machine retired" });
  const pool = rows[0].pool as PoolName;
  await sql`UPDATE vast_instances SET last_seen_at = now() WHERE label = ${label}`;

  const action = String(req.body?.action || "");

  if (action === "manifest") {
    const models = (await sql`SELECT path, r2_key, size_bytes FROM vast_models WHERE pool = ${pool} ORDER BY path`) as any[];
    const out = await Promise.all(models.map(async (m) => ({
      path: m.path,
      size: m.size_bytes == null ? null : Number(m.size_bytes),
      url: await getDownloadUrl(m.r2_key, 6 * 3600),
    })));
    return res.status(200).json({ pool, models: out });
  }

  if (action === "ready") {
    await sql`UPDATE vast_instances SET status = 'ready', ready_at = COALESCE(ready_at, now()) WHERE label = ${label}`;
    console.log(`[vast] ${label} ready`);
    return res.status(200).json({ ok: true });
  }

  if (action === "log") {
    const line = String(req.body?.line || "").slice(0, 500).replace(/[\r\n]+/g, " ");
    console.log(`[vast] ${label}: ${line}`);
    return res.status(200).json({ ok: true });
  }

  if (action === "next") {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const job = await claimVastJob(pool, label);
      if (job) return res.status(200).json({ job });
      await new Promise((r) => setTimeout(r, 1000));
      if (req.socket.destroyed) return;
    }
    await sql`UPDATE vast_instances SET last_seen_at = now() WHERE label = ${label}`;
    return res.status(200).json({ job: null });
  }

  if (action === "result") {
    const id = String(req.body?.id || "");
    if (!SAFE_JOB_RE.test(id)) return res.status(400).json({ error: "bad id" });
    const error = req.body?.error ? String(req.body.error) : undefined;
    await finishVastJob(id, label, error ? { error } : { output: req.body?.output ?? {} });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "unknown action" });
}
