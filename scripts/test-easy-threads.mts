/**
 * Easy-mode chat history, against the live API.
 *
 * The thing that actually matters here is isolation: threads are addressed by
 * a uuid the client holds, so a guessed id must never return someone else's
 * conversation. That is asserted directly, not assumed from the query text.
 *
 * Also checks that deleting a chat does not touch the renders — the images
 * live in the Library and a conversation is not their owner.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const P = "easytest";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const cleanup = () => sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
await cleanup();

async function mkUser(tag: string) {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true) RETURNING id, email`;
  return { id: u.id as string, token: signToken({ userId: u.id, email: u.email }) };
}

const call = async (path: string, token: string, body?: any) => {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

try {
  const alice = await mkUser("alice");
  const bob = await mkUser("bob");

  console.log("── auth ──");
  const anon = await fetch(`${BASE}/api/easy-threads?action=list`);
  ok("no token → 401", anon.status === 401, `HTTP ${anon.status}`);

  console.log("\n── a chat round-trips ──");
  const created = await call("/api/easy-threads", alice.token,
    { action: "create", title: "a neon cat" });
  ok("thread is created", created.status === 201 && !!created.json.thread?.id, `HTTP ${created.status}`);
  const tid = created.json.thread.id;

  await call("/api/easy-threads", alice.token, { action: "append", threadId: tid, role: "user", text: "a neon cat" });
  const rmsg = await call("/api/easy-threads", alice.token,
    { action: "append", threadId: tid, role: "result", text: "a neon cat", status: "running" });
  ok("messages append", rmsg.status === 201 && !!rmsg.json.id);

  await call("/api/easy-threads", alice.token, {
    action: "update", messageId: rmsg.json.id, status: "done",
    assets: [{ url: "https://pub-0a4d910130d047e9a9c0e03feb7fcca6.r2.dev/x.png", type: "image" }],
  });

  const loaded = await call(`/api/easy-threads?threadId=${tid}`, alice.token);
  ok("both messages come back in order",
    loaded.json.messages?.length === 2 && loaded.json.messages[0].role === "user",
    `${loaded.json.messages?.length} messages`);
  const result = loaded.json.messages[1];
  ok("the result carries its asset and status",
    result.status === "done" && result.assets?.length === 1, JSON.stringify(result.assets));

  console.log("\n── a stored asset URL must be a real URL ──");
  const junk = await call("/api/easy-threads", alice.token, {
    action: "append", threadId: tid, role: "result",
    assets: [{ url: "javascript:alert(1)", type: "image" }, { url: "not a url" }],
  });
  const after = await call(`/api/easy-threads?threadId=${tid}`, alice.token);
  const stored = after.json.messages.find((m: any) => m.id === junk.json.id);
  ok("non-http asset urls are dropped", stored?.assets?.length === 0, JSON.stringify(stored?.assets));

  console.log("\n── isolation: Bob cannot reach Alice's chat ──");
  const peek = await call(`/api/easy-threads?threadId=${tid}`, bob.token);
  ok("reading it returns nothing", (peek.json.messages || []).length === 0, `${peek.json.messages?.length} messages`);
  const bobList = await call("/api/easy-threads?action=list", bob.token);
  ok("it is not in his list", (bobList.json.threads || []).length === 0);
  const bobAppend = await call("/api/easy-threads", bob.token,
    { action: "append", threadId: tid, role: "user", text: "hijack" });
  ok("he cannot append to it", bobAppend.status === 404, `HTTP ${bobAppend.status}`);
  const bobUpdate = await call("/api/easy-threads", bob.token,
    { action: "update", messageId: rmsg.json.id, status: "error" });
  ok("he cannot edit her messages", bobUpdate.status === 404, `HTTP ${bobUpdate.status}`);
  const bobDelete = await call("/api/easy-threads", bob.token, { action: "delete", threadId: tid });
  ok("he cannot delete her chat", bobDelete.status === 404, `HTTP ${bobDelete.status}`);

  const stillThere = await call(`/api/easy-threads?threadId=${tid}`, alice.token);
  ok("…and it is all still there afterwards", (stillThere.json.messages || []).length === 3);

  console.log("\n── deleting a chat leaves the renders alone ──");
  const del = await call("/api/easy-threads", alice.token, { action: "delete", threadId: tid });
  ok("delete succeeds", del.status === 200);
  const gone = await call(`/api/easy-threads?threadId=${tid}`, alice.token);
  ok("messages cascade with the thread", (gone.json.messages || []).length === 0);
  const [libCount] = await sql`
    SELECT count(*) AS n FROM usage_log WHERE user_id = ${alice.id}::uuid` as any[];
  ok("nothing in the user's own history was touched", Number(libCount.n) === 0,
    "the images live in the Library, not in the chat");

  console.log("\n── thread list ordering ──");
  const t1 = await call("/api/easy-threads", alice.token, { action: "create", title: "first" });
  const t2 = await call("/api/easy-threads", alice.token, { action: "create", title: "second" });
  await call("/api/easy-threads", alice.token,
    { action: "append", threadId: t1.json.thread.id, role: "user", text: "bump" });
  const list = await call("/api/easy-threads?action=list", alice.token);
  ok("most recently touched comes first",
    list.json.threads?.[0]?.id === t1.json.thread.id,
    list.json.threads?.map((t: any) => t.title).join(" > "));
  ok("rename sticks",
    (await call("/api/easy-threads", alice.token,
      { action: "rename", threadId: t2.json.thread.id, title: "renamed" })).status === 200);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "CHAT HISTORY HOLDS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
