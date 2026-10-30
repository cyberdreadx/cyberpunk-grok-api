/**
 * Vast.ai overflow for RunPod.
 *
 * When a RunPod endpoint can't get a GPU (workers "throttled", none ready),
 * new jobs for that pool go to a Vast.ai machine instead. The Vast machine runs
 * the SAME worker image as RunPod, so workflows and outputs are identical.
 *
 * How it fits together
 *  - comfyui.ts sends every RunPod call through runpodRequest(). That function
 *    asks routeRunpodCall() first; for a "/run" during a shortage it enqueues
 *    the job here and hands back a RunPod-shaped reply with id "vast-<uuid>".
 *    Status / cancel for "vast-" ids are answered from this queue, in RunPod's
 *    shape, so the rest of comfyui.ts (billing, refunds, R2 upload) is unchanged.
 *  - Vast workers PULL jobs from /api/vast-worker over HTTPS with a per-machine
 *    token. Nothing listens on the Vast machine, so there is no open port and
 *    no user content crosses the internet unencrypted.
 *  - The scaler (cron, every minute) rents a machine when a pool is short and
 *    destroys it after VAST_IDLE_MINUTES with no work.
 *
 * Privacy: only Vast DATACENTER hosts are ever rented (never home PCs), job
 * inputs/outputs are deleted from the queue as soon as they're delivered, and
 * machines are destroyed (not stopped) so nothing lingers on their disks.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";

// ── Pools ────────────────────────────────────────────────────────────────────

export type PoolName = "image" | "wan" | "ltx";

export interface PoolSpec {
  name: PoolName;
  /** Worker image (built by .github/workflows/vast-images.yml). */
  image: string;
  minVramGb: number;
  diskGb: number;
}

const IMAGE_BASE = process.env.VAST_IMAGE_BASE || "ghcr.io/cyberdreadx/gltch-worker";
const IMAGE_TAG = process.env.VAST_IMAGE_TAG || "latest";

export const POOLS: Record<PoolName, PoolSpec> = {
  // Klein edit, Z-Image, Krea 2 (RunPod: QWEN_EDIT endpoint, Dockerfile.zimage)
  image: { name: "image", image: `${IMAGE_BASE}-image:${IMAGE_TAG}`, minVramGb: 24, diskGb: 120 },
  // WAN + LongLook (RunPod: WAN endpoint, Dockerfile)
  wan: { name: "wan", image: `${IMAGE_BASE}-wan:${IMAGE_TAG}`, minVramGb: 48, diskGb: 220 },
  // LTX-2.3 with audio (RunPod: LTX endpoint, Dockerfile.ltx). H200-only on RunPod.
  ltx: { name: "ltx", image: `${IMAGE_BASE}-ltx:${IMAGE_TAG}`, minVramGb: 80, diskGb: 150 },
};

/** Which pool serves a RunPod endpoint id. Null = never overflow it. */
export function poolForEndpoint(endpointId: string): PoolName | null {
  const e = process.env;
  const map: Array<[string | undefined, PoolName]> = [
    [e.RUNPOD_QWEN_EDIT_ENDPOINT_ID, "image"],
    [e.RUNPOD_ZIMAGE_ENDPOINT_ID, "image"],
    [e.RUNPOD_LTX_ENDPOINT_ID, "ltx"],
    [e.RUNPOD_WAN_ENDPOINT_ID, "wan"],
    [e.RUNPOD_LONGLOOK_ENDPOINT_ID, "wan"],
    [e.RUNPOD_ENDPOINT_ID, "wan"],
  ];
  for (const [id, pool] of map) if (id && id === endpointId) return pool;
  return null;
}

export function enabledPools(): PoolName[] {
  if (!isVastConfigured()) return [];
  const raw = (process.env.VAST_POOLS || "image,wan,ltx").split(",").map((s) => s.trim());
  return raw.filter((p): p is PoolName => p in POOLS);
}

export function isVastConfigured(): boolean {
  return !!(process.env.VAST_API_KEY && process.env.VAST_WORKER_SECRET);
}

// ── Tables ───────────────────────────────────────────────────────────────────

let tablesReady: Promise<void> | null = null;
export function ensureVastTables(): Promise<void> {
  if (!tablesReady) {
    const sql = getDb();
    tablesReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS vast_jobs (
        id text PRIMARY KEY,
        pool text NOT NULL,
        endpoint_id text NOT NULL,
        status text NOT NULL DEFAULT 'IN_QUEUE',
        input jsonb,
        output jsonb,
        error text,
        worker text,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz
      )`;
      await sql`CREATE INDEX IF NOT EXISTS vast_jobs_queue ON vast_jobs (pool, created_at) WHERE status = 'IN_QUEUE'`;
      await sql`CREATE TABLE IF NOT EXISTS vast_instances (
        label text PRIMARY KEY,
        pool text NOT NULL,
        instance_id bigint,
        gpu text,
        dph numeric,
        status text NOT NULL DEFAULT 'creating',
        created_at timestamptz NOT NULL DEFAULT now(),
        ready_at timestamptz,
        last_seen_at timestamptz,
        last_job_at timestamptz,
        destroyed_at timestamptz,
        note text
      )`;
      await sql`CREATE TABLE IF NOT EXISTS vast_models (
        pool text NOT NULL,
        path text NOT NULL,
        r2_key text NOT NULL,
        size_bytes bigint,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (pool, path)
      )`;
    })().catch((e) => { tablesReady = null; throw e; });
  }
  return tablesReady;
}

// ── Worker tokens ────────────────────────────────────────────────────────────

function sign(label: string): string {
  return createHmac("sha256", process.env.VAST_WORKER_SECRET || "").update(label).digest("base64url");
}
export function workerToken(label: string): string {
  return `${label}.${sign(label)}`;
}
/** Returns the machine label for a valid token, else null. */
export function verifyWorkerToken(token: string): string | null {
  if (!process.env.VAST_WORKER_SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const label = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(label));
  return a.length === b.length && timingSafeEqual(a, b) ? label : null;
}

// ── RunPod health (shortage detection) ───────────────────────────────────────

type Health = { workers?: Record<string, number>; jobs?: Record<string, number> };
const healthCache = new Map<string, { at: number; h: Health | null }>();

export async function runpodHealth(endpointId: string): Promise<Health | null> {
  const hit = healthCache.get(endpointId);
  if (hit && Date.now() - hit.at < 15_000) return hit.h;
  let h: Health | null = null;
  try {
    const r = await fetch(`https://api.runpod.ai/v2/${endpointId}/health`, {
      headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY || ""}` },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) h = (await r.json()) as Health;
  } catch { /* unknown */ }
  healthCache.set(endpointId, { at: Date.now(), h });
  return h;
}

/**
 * RunPod can't serve this endpoint right now: nothing idle or ready, and RunPod
 * itself reports throttled workers (it wants GPUs it can't get). A busy-but-
 * healthy endpoint (running jobs, no throttling) is NOT a shortage — it scales.
 */
export function isShort(h: Health | null): boolean {
  if (!h?.workers) return false;
  const w = h.workers;
  const available = (w.idle ?? 0) + (w.ready ?? 0);
  return available === 0 && (w.throttled ?? 0) > 0;
}

async function poolHasLiveWorker(pool: PoolName): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`SELECT 1 FROM vast_instances
    WHERE pool = ${pool} AND status = 'ready' AND last_seen_at > now() - interval '90 seconds' LIMIT 1`;
  return rows.length > 0;
}

/** Overflow forced on (testing) via VAST_FORCE_POOLS=image,ltx */
function forced(pool: PoolName): boolean {
  return (process.env.VAST_FORCE_POOLS || "").split(",").map((s) => s.trim()).includes(pool);
}

/** Should a new job for this endpoint go to Vast? */
export async function shouldOverflow(endpointId: string): Promise<PoolName | null> {
  const pool = poolForEndpoint(endpointId);
  if (!pool || !enabledPools().includes(pool)) return null;
  await ensureVastTables();
  if (!(await poolHasLiveWorker(pool))) return null;
  if (forced(pool)) return pool;
  return isShort(await runpodHealth(endpointId)) ? pool : null;
}

// ── Queue ────────────────────────────────────────────────────────────────────

export function isVastJobId(id: string): boolean {
  return id.startsWith("vast-");
}

export async function enqueueVastJob(pool: PoolName, endpointId: string, input: unknown): Promise<string> {
  await ensureVastTables();
  const id = `vast-${randomUUID()}`;
  const sql = getDb();
  await sql`INSERT INTO vast_jobs (id, pool, endpoint_id, input) VALUES (${id}, ${pool}, ${endpointId}, ${JSON.stringify(input)}::jsonb)`;
  console.log(`[vast] job ${id} → pool ${pool} (RunPod ${endpointId} short)`);
  return id;
}

/** RunPod-shaped status. Output is deleted once handed over. */
export async function vastJobStatus(id: string): Promise<Record<string, unknown>> {
  await ensureVastTables();
  const sql = getDb();
  const rows = await sql`SELECT id, status, output, error, created_at, started_at, finished_at FROM vast_jobs WHERE id = ${id}`;
  if (!rows.length) return { id, status: "FAILED", error: "Job not found" };
  const j = rows[0] as any;
  const out: Record<string, unknown> = { id, status: j.status };
  if (j.started_at) out.delayTime = +new Date(j.started_at) - +new Date(j.created_at);
  if (j.finished_at && j.started_at) out.executionTime = +new Date(j.finished_at) - +new Date(j.started_at);
  if (j.status === "COMPLETED") {
    out.output = j.output ?? {};
    // Privacy + size: drop the payload once delivered; keep the row for stats.
    await sql`UPDATE vast_jobs SET output = NULL, input = NULL WHERE id = ${id}`;
  } else if (j.status === "FAILED" || j.status === "CANCELLED" || j.status === "TIMED_OUT") {
    out.error = j.error || "Generation failed";
    await sql`UPDATE vast_jobs SET input = NULL WHERE id = ${id}`;
  }
  return out;
}

export async function cancelVastJob(id: string): Promise<Record<string, unknown>> {
  await ensureVastTables();
  const sql = getDb();
  await sql`UPDATE vast_jobs SET status = 'CANCELLED', input = NULL, finished_at = now()
            WHERE id = ${id} AND status IN ('IN_QUEUE', 'IN_PROGRESS')`;
  return { id, status: "CANCELLED" };
}

/** Worker side: claim the oldest queued job for this pool. */
export async function claimVastJob(pool: PoolName, label: string): Promise<{ id: string; input: unknown } | null> {
  const sql = getDb();
  const rows = await sql`
    UPDATE vast_jobs SET status = 'IN_PROGRESS', worker = ${label}, started_at = now()
    WHERE id = (
      SELECT id FROM vast_jobs WHERE pool = ${pool} AND status = 'IN_QUEUE'
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, input`;
  if (!rows.length) return null;
  const r = rows[0] as any;
  await sql`UPDATE vast_instances SET last_job_at = now() WHERE label = ${label}`;
  return { id: r.id, input: r.input };
}

export async function finishVastJob(id: string, label: string, result: { output?: unknown; error?: string }) {
  const sql = getDb();
  const failed = !!result.error;
  await sql`UPDATE vast_jobs SET
      status = ${failed ? "FAILED" : "COMPLETED"},
      output = ${failed ? null : JSON.stringify(result.output ?? {})}::jsonb,
      error = ${failed ? String(result.error).slice(0, 2000) : null},
      input = NULL,
      finished_at = now()
    WHERE id = ${id} AND worker = ${label} AND status = 'IN_PROGRESS'`;
  await sql`UPDATE vast_instances SET last_job_at = now() WHERE label = ${label}`;
}

/** Jobs stuck on a worker that vanished go back to the queue (once), then fail. */
export async function requeueStaleJobs(): Promise<void> {
  const sql = getDb();
  await sql`UPDATE vast_jobs SET status = 'FAILED', error = 'GPU machine went away', finished_at = now(), input = NULL
    WHERE status = 'IN_PROGRESS' AND started_at < now() - interval '25 minutes'`;
  await sql`UPDATE vast_jobs SET status = 'FAILED', error = 'No GPU became available in time', finished_at = now(), input = NULL
    WHERE status = 'IN_QUEUE' AND created_at < now() - interval '20 minutes'`;
  // Delivered-or-abandoned payloads never sit around.
  await sql`UPDATE vast_jobs SET output = NULL, input = NULL WHERE finished_at < now() - interval '1 hour' AND (output IS NOT NULL OR input IS NOT NULL)`;
  await sql`DELETE FROM vast_jobs WHERE created_at < now() - interval '30 days'`;
}

// ── Vast.ai REST ─────────────────────────────────────────────────────────────

const VAST_API = "https://console.vast.ai/api/v0";

async function vast(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${VAST_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.VAST_API_KEY || ""}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  if (!r.ok) throw new Error(`Vast ${init.method || "GET"} ${path} → ${r.status}: ${text.slice(0, 300)}`);
  return body;
}

export interface VastOffer {
  id: number;
  gpu_name: string;
  gpu_ram: number;
  dph_total: number;
  reliability2?: number;
  inet_down?: number;
  datacenter?: boolean;
  hosting_type?: number;
  geolocation?: string;
}

const maxDph = () => Number(process.env.VAST_MAX_DPH || "3");

export async function searchOffers(pool: PoolName): Promise<VastOffer[]> {
  const spec = POOLS[pool];
  const q = {
    verified: { eq: true },
    rentable: { eq: true },
    rented: { eq: false },
    datacenter: { eq: true }, // never consumer machines — user content runs here
    num_gpus: { eq: 1 },
    gpu_ram: { gte: spec.minVramGb * 1000 },
    disk_space: { gte: spec.diskGb },
    cuda_max_good: { gte: 12.4 },
    inet_down: { gte: 800 },
    reliability2: { gte: 0.98 },
    dph_total: { lte: maxDph() },
    order: [["dph_total", "asc"]],
    type: "on-demand",
    limit: 20,
  };
  const body = await vast(`/bundles/`, { method: "POST", body: JSON.stringify(q) });
  const offers: VastOffer[] = body?.offers ?? [];
  // Belt and braces: re-check the datacenter flag on what came back.
  return offers.filter((o) => o.datacenter === true || o.hosting_type === 1);
}

export async function createInstance(pool: PoolName, offer: VastOffer, label: string): Promise<number> {
  const spec = POOLS[pool];
  const env: Record<string, string> = {
    GLTCH_API: process.env.VAST_CALLBACK_BASE || "https://api.gltch.app",
    GLTCH_WORKER_TOKEN: workerToken(label),
    GLTCH_POOL: pool,
  };
  if (process.env.CIVITAI_API_TOKEN) env.CIVITAI_API_TOKEN = process.env.CIVITAI_API_TOKEN;
  const login = process.env.VAST_REGISTRY_LOGIN; // e.g. "-u USER -p TOKEN ghcr.io"
  const body = {
    client_id: "me",
    image: spec.image,
    ...(login ? { image_login: login } : {}),
    env,
    disk: spec.diskGb,
    label,
    runtype: "args",
    // Image ENTRYPOINT (/entrypoint.sh) runs, then execs these args.
    args: ["/vast_start.sh"],
    target_state: "running",
  };
  const r = await vast(`/asks/${offer.id}/`, { method: "PUT", body: JSON.stringify(body) });
  const id = Number(r?.new_contract);
  if (!r?.success || !id) throw new Error(`Vast create failed: ${JSON.stringify(r).slice(0, 300)}`);
  return id;
}

export async function destroyInstance(instanceId: number): Promise<void> {
  await vast(`/instances/${instanceId}/`, { method: "DELETE" });
}

export async function listInstances(): Promise<any[]> {
  const r = await vast(`/instances/?owner=me`);
  return r?.instances ?? [];
}

// ── Scaler ───────────────────────────────────────────────────────────────────

const shortSince = new Map<PoolName, number>();

function endpointsFor(pool: PoolName): string[] {
  const e = process.env;
  const ids = pool === "image" ? [e.RUNPOD_QWEN_EDIT_ENDPOINT_ID]
    : pool === "ltx" ? [e.RUNPOD_LTX_ENDPOINT_ID]
    : [e.RUNPOD_WAN_ENDPOINT_ID || e.RUNPOD_ENDPOINT_ID];
  return ids.filter((x): x is string => !!x);
}

/**
 * One scaler pass. Rents a machine for a pool that has been short for
 * VAST_SHORT_SECONDS; destroys machines idle for VAST_IDLE_MINUTES while
 * RunPod is healthy again; destroys machines that never became ready.
 */
export async function scaleTick(): Promise<Record<string, unknown>> {
  if (!isVastConfigured()) return { skipped: "VAST_API_KEY / VAST_WORKER_SECRET not set" };
  await ensureVastTables();
  await requeueStaleJobs();
  const sql = getDb();
  const report: Record<string, unknown> = {};
  const shortSecs = Number(process.env.VAST_SHORT_SECONDS || "60");
  const idleMin = Number(process.env.VAST_IDLE_MINUTES || "15");
  const bootMin = Number(process.env.VAST_BOOT_MINUTES || "45");
  const maxTotal = Number(process.env.VAST_MAX_INSTANCES || "3");

  const live = (await sql`SELECT * FROM vast_instances WHERE destroyed_at IS NULL`) as any[];

  for (const pool of enabledPools()) {
    const eps = endpointsFor(pool);
    const healths = await Promise.all(eps.map(runpodHealth));
    const short = forced(pool) || healths.some(isShort);
    if (short) { if (!shortSince.has(pool)) shortSince.set(pool, Date.now()); }
    else shortSince.delete(pool);
    const mine = live.filter((i) => i.pool === pool);
    const queued = Number(((await sql`SELECT COUNT(*)::int n FROM vast_jobs WHERE pool = ${pool} AND status = 'IN_QUEUE'`) as any[])[0].n);
    const entry: Record<string, unknown> = { short, machines: mine.length, queued };

    // Scale up: one machine per pool while short (more if a queue builds).
    const wantUp = short && Date.now() - (shortSince.get(pool) ?? Date.now()) >= shortSecs * 1000;
    const want = wantUp ? (queued > 6 && mine.length >= 1 ? 2 : 1) : 0;
    if (mine.length < want && live.length < maxTotal) {
      try {
        const offers = await searchOffers(pool);
        if (!offers.length) entry.up = "no datacenter offers under VAST_MAX_DPH";
        else {
          const offer = offers[0];
          const label = `gltch-${pool}-${randomBytes(4).toString("hex")}`;
          await sql`INSERT INTO vast_instances (label, pool, gpu, dph, status) VALUES (${label}, ${pool}, ${offer.gpu_name}, ${offer.dph_total}, 'creating')`;
          try {
            const id = await createInstance(pool, offer, label);
            await sql`UPDATE vast_instances SET instance_id = ${id}, status = 'booting' WHERE label = ${label}`;
            entry.up = { label, id, gpu: offer.gpu_name, dph: offer.dph_total, where: offer.geolocation };
            console.log(`[vast] rented ${offer.gpu_name} $${offer.dph_total}/h for ${pool} (${label}, #${id})`);
          } catch (e: any) {
            await sql`UPDATE vast_instances SET status = 'failed', destroyed_at = now(), note = ${String(e.message).slice(0, 500)} WHERE label = ${label}`;
            throw e;
          }
        }
      } catch (e: any) {
        entry.upError = e.message;
        console.error(`[vast] scale-up ${pool} failed:`, e.message);
      }
    }

    // Scale down.
    for (const m of mine) {
      const ageMin = (Date.now() - +new Date(m.created_at)) / 60_000;
      const lastWork = Math.max(+new Date(m.last_job_at || 0), +new Date(m.ready_at || m.created_at));
      const idleFor = (Date.now() - lastWork) / 60_000;
      const busy = Number(((await sql`SELECT COUNT(*)::int n FROM vast_jobs WHERE worker = ${m.label} AND status = 'IN_PROGRESS'`) as any[])[0].n) > 0;
      let why = "";
      if (m.status !== "ready" && ageMin > bootMin) why = `never became ready in ${bootMin} min`;
      else if (m.status === "ready" && m.last_seen_at && Date.now() - +new Date(m.last_seen_at) > 5 * 60_000) why = "stopped checking in";
      else if (m.status === "ready" && !short && !busy && queued === 0 && idleFor >= idleMin) why = `idle ${Math.round(idleFor)} min, RunPod healthy`;
      if (!why) continue;
      try {
        if (m.instance_id) await destroyInstance(Number(m.instance_id));
        await sql`UPDATE vast_instances SET status = 'destroyed', destroyed_at = now(), note = ${why} WHERE label = ${m.label}`;
        console.log(`[vast] destroyed ${m.label}: ${why}`);
        (entry.down ??= [] as string[]) && (entry.down as string[]).push(`${m.label}: ${why}`);
      } catch (e: any) {
        entry.downError = e.message;
      }
    }
    report[pool] = entry;
  }
  return report;
}

/** Destroy every machine we own. Admin kill switch. */
export async function destroyAll(): Promise<number> {
  await ensureVastTables();
  const sql = getDb();
  const rows = (await sql`SELECT label, instance_id FROM vast_instances WHERE destroyed_at IS NULL`) as any[];
  for (const r of rows) {
    try { if (r.instance_id) await destroyInstance(Number(r.instance_id)); } catch { /* already gone */ }
    await sql`UPDATE vast_instances SET status = 'destroyed', destroyed_at = now(), note = 'admin kill switch' WHERE label = ${r.label}`;
  }
  return rows.length;
}
