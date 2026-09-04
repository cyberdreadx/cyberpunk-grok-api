/**
 * Exercise /api/easy-threads end to end.
 *
 * Easy-mode chats are reported as not appearing in the sidebar and losing
 * their attached media. That is either the API not storing them or the client
 * not calling it; this settles which before any code is changed.
 *
 *   node --env-file=.env --import tsx scripts/easy-threads-smoke.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";

const [owner] = await sql`SELECT id, email FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });

const call = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}/api/easy-threads${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
};
const post = (b: any) => call("", { method: "POST", body: JSON.stringify(b) });

// What the DB already holds — if the sidebar is empty but rows exist, the bug
// is on the read path, not the write path.
const [pre] = await sql`
  SELECT count(*)::int AS threads,
         (SELECT count(*)::int FROM easy_messages WHERE user_id = ${owner.id}::uuid) AS messages,
         (SELECT count(*)::int FROM easy_messages
           WHERE user_id = ${owner.id}::uuid AND jsonb_array_length(assets) > 0) AS with_assets
  FROM easy_threads WHERE user_id = ${owner.id}::uuid` as any[];
console.log(`existing for ${owner.email}: ${pre.threads} threads, ${pre.messages} messages, ${pre.with_assets} carrying assets\n`);

const created = await post({ action: "create", title: "smoke test" });
console.log(`create  HTTP ${created.status}  id=${created.body?.thread?.id ?? "-"}`);
const tid = created.body?.thread?.id;
if (!tid) { console.error(JSON.stringify(created.body).slice(0, 300)); process.exit(1); }

const userMsg = await post({ action: "append", threadId: tid, role: "user", text: "a cat" });
console.log(`append user    HTTP ${userMsg.status}  id=${userMsg.body?.id ?? "-"}`);

const resultMsg = await post({ action: "append", threadId: tid, role: "result", status: "running", label: "Image" });
console.log(`append result  HTTP ${resultMsg.status}  id=${resultMsg.body?.id ?? "-"}`);

const ASSET = { url: "https://pub-0a4d910130d047e9a9c0e03feb7fcca6.r2.dev/smoke.png", type: "image" };
const upd = await post({ action: "update", messageId: resultMsg.body?.id, status: "done", assets: [ASSET] });
console.log(`update assets  HTTP ${upd.status}`);

const list = await call("?action=list");
const inList = (list.body?.threads || []).some((t: any) => t.id === tid);
console.log(`\nlist    HTTP ${list.status}  ${list.body?.threads?.length ?? 0} threads  contains new: ${inList}`);

const load = await call(`?threadId=${tid}`);
const msgs = load.body?.messages || [];
const stored = msgs.find((m: any) => m.id === resultMsg.body?.id);
console.log(`load    HTTP ${load.status}  ${msgs.length} messages`);
console.log(`  result row status=${stored?.status ?? "-"} assets=${JSON.stringify(stored?.assets ?? [])}`);

const assetOk = Array.isArray(stored?.assets) && stored.assets.length === 1 && stored.assets[0].url === ASSET.url;
console.log(`\nthread in sidebar list : ${inList ? "YES" : "NO"}`);
console.log(`media survived round-trip: ${assetOk ? "YES" : "NO"}`);

await post({ action: "delete", threadId: tid });
console.log("\n(smoke thread deleted)");
process.exit(inList && assetOk ? 0 : 1);
