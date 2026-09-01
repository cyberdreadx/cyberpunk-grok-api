/**
 * A refund must put credits back in the bucket that paid.
 *
 * Before migration 060 every app refund called add_pack_credits(), so a job
 * paid for with expiring daily credits came back as permanent pack credits —
 * 31,142 credits upgraded that way in the last year.
 *
 * Tested against the real functions on a scratch user, then cleaned up.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const P = "refundtest";
const cleanup = () => sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
await cleanup();

const mk = async (tag: string, daily: number, sub: number, pack: number) => {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified, daily_credits, sub_credits, pack_credits)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true, ${daily}, ${sub}, ${pack})
    RETURNING id`;
  return u.id as string;
};
const balance = async (id: string) => {
  const [u] = await sql`
    SELECT daily_credits AS d, sub_credits AS s, pack_credits AS p
    FROM users WHERE id = ${id}::uuid`;
  return `${u.d}/${u.s}/${u.p}`;
};

try {
  console.log("── deduct_credits_split reports what it took (daily → sub → pack) ──");
  for (const [tag, start, cost, expectSplit, expectAfter] of [
    ["all-daily", [10, 10, 10], 5, "5/0/0", "5/10/10"],
    ["spans-two", [3, 10, 10], 5, "3/2/0", "0/8/10"],
    ["spans-all", [1, 1, 10], 5, "1/1/3", "0/0/7"],
    ["pack-only", [0, 0, 10], 5, "0/0/5", "0/0/5"],
  ] as const) {
    const id = await mk(tag, start[0], start[1], start[2]);
    const [sp] = await sql`SELECT * FROM deduct_credits_split(${id}::uuid, ${cost})` as any[];
    const got = `${sp.from_daily}/${sp.from_sub}/${sp.from_pack}`;
    ok(`${tag}: ${start.join("/")} − ${cost} takes ${expectSplit}`, got === expectSplit, `got ${got}`);
    ok(`${tag}: balance becomes ${expectAfter}`, (await balance(id)) === expectAfter, `got ${await balance(id)}`);
  }

  console.log("\n── refund_credits puts each bucket back ──");
  for (const [tag, start, cost] of [
    ["r-daily", [10, 10, 10], 5],
    ["r-spans", [3, 10, 10], 5],
    ["r-all", [1, 1, 10], 5],
  ] as const) {
    const id = await mk(tag, start[0], start[1], start[2]);
    const before = await balance(id);
    const [sp] = await sql`SELECT * FROM deduct_credits_split(${id}::uuid, ${cost})` as any[];
    await sql`SELECT refund_credits(${id}::uuid, ${sp.from_daily}, ${sp.from_sub}, ${sp.from_pack})`;
    const after = await balance(id);
    ok(`${tag}: ${before} → deduct ${cost} → refund → ${before}`, after === before, `got ${after}`);
  }

  console.log("\n── what the old flat refund did instead ──");
  const id = await mk("old-way", 10, 0, 0);
  await sql`SELECT deduct_credits(${id}::uuid, 5)`;
  await sql`SELECT add_pack_credits(${id}::uuid, 5)`;
  const drifted = await balance(id);
  ok("add_pack_credits turns 10/0/0 into 5/0/5, not 10/0/0", drifted === "5/0/5",
    `got ${drifted} — 5 expiring credits became permanent`);

  console.log("\n── pre-060 rows (NULL split) still refund, via the pack fallback ──");
  const legacy = await mk("legacy", 0, 0, 10);
  await sql`SELECT refund_credits(${legacy}::uuid, ${null}, ${null}, ${null})`;
  ok("a NULL split adds nothing rather than throwing", (await balance(legacy)) === "0/0/10");

  console.log("\n── usage_log records the split going forward ──");
  const cols = await sql`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'usage_log' AND column_name LIKE 'paid_%' ORDER BY column_name`;
  ok("paid_daily / paid_sub / paid_pack exist", cols.length === 3,
    cols.map((c: any) => c.column_name).join(", "));
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "REFUNDS GO BACK WHERE THEY CAME FROM" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
