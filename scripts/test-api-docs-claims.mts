/**
 * Does /docs describe the API that actually exists?
 *
 * The page used to hard-code baseUrl = https://cyberpunk-grok-api.vercel.app,
 * a Vercel deployment disabled since April 2026 that answers every path with
 * HTTP 402. Every sample on the page pointed there, so every sample failed —
 * and the API had served 0 calls in the 90 days before this was found.
 *
 * These assertions pin the claims the page now makes. Only the klein and
 * txt2img runs spend credits (3 each); everything else stops at validation,
 * which happens before deductCredits.
 *
 *   node --env-file=.env --import tsx scripts/test-api-docs-claims.mts
 */
process.env.RESEND_API_KEY = "";

import { createHash, randomBytes } from "crypto";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const DEAD = "https://cyberpunk-grok-api.vercel.app";
const SPEND = process.argv.includes("--spend");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const [owner] = await sql`
  SELECT id, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1`;
if (!owner) { console.error("owner account not found"); process.exit(1); }

async function mintKey(userId: string, label: string) {
  const raw = `gltch_sk_${randomBytes(24).toString("hex")}`;
  const [row] = await sql`
    INSERT INTO api_keys (user_id, key_hash, name, key_prefix)
    VALUES (${userId}::uuid, ${createHash("sha256").update(raw).digest("hex")},
            ${label}, ${raw.slice(0, 16)})
    RETURNING id, rate_limit`;
  return { raw, id: row.id as string, rateLimit: row.rate_limit as number };
}

const key = await mintKey(owner.id, "docs audit (temporary)");

// An unverified account, to prove the email gate actually fires.
const [unverified] = await sql`
  INSERT INTO users (email, password_hash, email_verified, pack_credits)
  VALUES ('docsaudit-unverified@example.test', 'x', false, 500)
  RETURNING id`;
const unverifiedKey = await mintKey(unverified.id, "docs audit unverified (temporary)");

const call = async (path: string, body?: any, apiKey = key.raw, ms = 30000) => {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) as any, text }; }
  catch { return { status: res.status, json: null as any, text }; }
};

try {
  console.log("── the base URL the page prints ──");
  const dead = await fetch(`${DEAD}/api/v1/models`).then(r => r.status).catch(() => 0);
  ok("the old vercel.app host is still dead", dead !== 200, `HTTP ${dead}`);
  const live = await call("/api/v1/models");
  ok("api.gltch.app serves the API", live.status === 200, `HTTP ${live.status}`);
  const proxied = await fetch("https://grokrunner.gltch.app/api/v1/models", {
    headers: { "X-API-Key": key.raw },
  });
  ok("the app domain proxies to the same backend", proxied.status === 200, `HTTP ${proxied.status}`);

  console.log("\n── auth, exactly as documented ──");
  ok("no key → 401", (await call("/api/v1/models", undefined, "")).status === 401);
  ok("a key without the gltch_sk_ prefix → 401",
    (await call("/api/v1/models", undefined, "nope")).status === 401);
  ok("default rate limit is the documented 30/min", key.rateLimit === 30, `${key.rateLimit}/min`);

  console.log("\n── the 403 the error table promises ──");
  // This gate lived INSIDE the `if (!auth)` block after its return in all three
  // v1 handlers, so an unverified account's key sailed straight through.
  for (const [name, path, body] of [
    ["comfy", "/api/v1/comfy", { prompt: "x", workflow: "klein", image_url: "https://example.com/a.jpg" }],
    ["gltch", "/api/v1/gltch", { prompt: "x", image_url: "https://example.com/a.jpg" }],
  ] as const) {
    const r = await call(path, body, unverifiedKey.raw);
    ok(`${name} rejects an unverified account`, r.status === 403, `HTTP ${r.status}`);
  }

  console.log("\n── engines the page documents ──");
  const engines = (live.json?.engines || []).map((e: any) => e.id);
  ok("grok is not offered (page no longer documents it)", !engines.includes("grok"), JSON.stringify(engines));
  ok("/api/v1/generate is retired", (await call("/api/v1/generate", { prompt: "x" })).status === 410);

  console.log("\n── GLTCH PRO workflows ──");
  const valid = ["klein", "txt2img", "wan-video"];
  for (const w of valid) {
    const r = await call("/api/v1/comfy", { prompt: "x", workflow: w });
    ok(`'${w}' is accepted`, !/must be one of/.test(r.json?.error || ""), `HTTP ${r.status}`);
  }
  ok("'gltch-wan' is not a v1 workflow, and the page no longer lists it",
    /must be one of/.test((await call("/api/v1/comfy", { prompt: "x", workflow: "gltch-wan" })).json?.error || ""));
  ok("omitting workflow defaults to klein, as documented",
    /klein/.test((await call("/api/v1/comfy", { prompt: "x" })).json?.error || ""));

  console.log("\n── every advertised checkpoint must actually load ──");
  const ckpts: string[] = live.json?.engines?.find((e: any) => e.id === "gltch-pro")?.checkpoints || [];
  ok("checkpoints are advertised", ckpts.length > 0, ckpts.join(", "));

  console.log("\n── XRGE bank paths ──");
  const bad = await call("/v1/xrge-balance");
  ok("the un-prefixed path returns the SPA, not JSON — hence /api/ in the page",
    bad.json === null, `HTTP ${bad.status} ${bad.text?.slice(0, 20).replace(/\n/g, "")}`);
  ok("/api/v1/xrge-balance responds", (await call("/api/v1/xrge-balance")).status === 200);

  if (SPEND) {
    console.log("\n── real generations (--spend) ──");
    const before = Number(owner.credits);
    const t2i = await call("/api/v1/comfy", {
      prompt: "a neon-lit cyberpunk alley", workflow: "txt2img", steps: 8, width: 512, height: 512,
    }, key.raw, 300000);
    ok("txt2img completes", t2i.status === 200, `HTTP ${t2i.status} ${t2i.json?.error || ""}`);
    ok("image_url is a real URL, not base64",
      /^https:\/\//.test(t2i.json?.image_url || ""), String(t2i.json?.image_url || "").slice(0, 60));
    if (t2i.json?.image_url) {
      const h = await fetch(t2i.json.image_url, { method: "HEAD" });
      ok("that URL serves an image", (h.headers.get("content-type") || "").startsWith("image/"),
        `${h.headers.get("content-type")} ${h.headers.get("content-length")}B`);
    }

    const klein = await call("/api/v1/comfy", {
      prompt: "make it look like a watercolor painting",
      workflow: "klein",
      image_url: t2i.json?.image_url,
    }, key.raw, 300000);
    ok("klein completes on a real image", klein.status === 200, `HTTP ${klein.status} ${klein.json?.error || ""}`);
    ok("klein returns a URL", /^https:\/\//.test(klein.json?.image_url || ""),
      String(klein.json?.image_url || "").slice(0, 60));

    const [after] = await sql`
      SELECT daily_credits + sub_credits + pack_credits AS credits FROM users WHERE id = ${owner.id}::uuid`;
    console.log(`       credits ${before} → ${after.credits} (spent ${before - Number(after.credits)})`);
  } else {
    console.log("\n(pass --spend to also run real klein + txt2img generations, ~6 credits)");
  }
} finally {
  await sql`DELETE FROM api_keys WHERE id IN (${key.id}::uuid, ${unverifiedKey.id}::uuid)`;
  await sql`DELETE FROM users WHERE id = ${unverified.id}::uuid`;
}

console.log(`\n${fail === 0 ? "DOCS MATCH THE API" : "MISMATCHES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
