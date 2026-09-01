/**
 * Real generations through /api/v1/comfy for the workflows people actually use.
 *
 * klein and gltch-wan are 97.6% of all jobs; gltch-wan was not reachable from
 * the public API at all until now, and zimage was third. These run end to end
 * against production — they spend credits (3 + 15 + 3) and take a few minutes,
 * because the only thing worth asserting is that a caller gets real media back.
 *
 *   node --env-file=.env --import tsx scripts/test-v1-workflows.mts
 */
process.env.RESEND_API_KEY = "";

import { createHash, randomBytes } from "crypto";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const [owner] = await sql`
  SELECT id, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1`;
const before = Number(owner.credits);

const raw = `gltch_sk_${randomBytes(24).toString("hex")}`;
const [key] = await sql`
  INSERT INTO api_keys (user_id, key_hash, name, key_prefix)
  VALUES (${owner.id}::uuid, ${createHash("sha256").update(raw).digest("hex")},
          'v1 workflow test (temporary)', ${raw.slice(0, 16)})
  RETURNING id`;

const call = async (body: any, ms = 290000) => {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/v1/comfy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": raw },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const json = await res.json().catch(() => ({} as any));
  return { status: res.status, json, secs: Math.round((Date.now() - t0) / 1000) };
};

const serves = async (url: string, prefix: string) => {
  const h = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30000) });
  const ct = h.headers.get("content-type") || "";
  const kb = Math.round(Number(h.headers.get("content-length") || 0) / 1024);
  return { good: h.ok && ct.startsWith(prefix), detail: `${ct} ${kb}KB` };
};

try {
  console.log("── zimage (3 cr) — text-to-image, no source needed ──");
  const z = await call({ prompt: "a neon-lit cyberpunk alley, rain, cinematic", workflow: "zimage" });
  ok("returns 200", z.status === 200, `${z.secs}s ${z.json?.error || ""}`);
  ok("gives an image URL", /^https:\/\//.test(z.json?.image_url || ""), String(z.json?.image_url || "").slice(0, 62));
  ok("charged 3 credits", z.json?.credits_used === 3, `${z.json?.credits_used}`);
  if (z.json?.image_url) {
    const r = await serves(z.json.image_url, "image/");
    ok("that URL serves an image", r.good, r.detail);
  }

  console.log("\n── klein (3 cr) — 78.5% of all jobs ──");
  const k = await call({
    prompt: "make it look like a watercolor painting",
    workflow: "klein",
    image_url: z.json?.image_url,
  });
  ok("returns 200", k.status === 200, `${k.secs}s ${k.json?.error || ""}`);
  ok("gives an image URL", /^https:\/\//.test(k.json?.image_url || ""), String(k.json?.image_url || "").slice(0, 62));
  ok("charged 3 credits", k.json?.credits_used === 3, `${k.json?.credits_used}`);

  console.log("\n── gltch-wan (15 cr) — 19.7% of jobs, brand new to this API ──");
  const g = await call({
    prompt: "slow cinematic push in, drifting neon reflections",
    workflow: "gltch-wan",
    image_url: z.json?.image_url,
    frame_count: 33,
  });
  ok("returns 200", g.status === 200, `${g.secs}s ${g.json?.error || ""}`);
  ok("response is typed comfy-video", g.json?.type === "comfy-video", String(g.json?.type));
  ok("gives a video URL", /^https:\/\//.test(g.json?.video_url || ""), String(g.json?.video_url || "").slice(0, 62));
  ok("charged 15 credits", g.json?.credits_used === 15, `${g.json?.credits_used}`);
  if (g.json?.video_url) {
    const r = await serves(g.json.video_url, "video/");
    ok("that URL serves a video", r.good, r.detail);
  }

  const [after] = await sql`
    SELECT daily_credits + sub_credits + pack_credits AS credits FROM users WHERE id = ${owner.id}::uuid`;
  console.log(`\n  credits ${before} → ${after.credits} (spent ${before - Number(after.credits)})`);
} finally {
  await sql`DELETE FROM api_keys WHERE id = ${key.id}::uuid`;
}

console.log(`\n${fail === 0 ? "ALL WORKFLOWS LIVE" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
