/**
 * The 7-day streak may advance at most once per calendar day.
 *
 * It used to advance inside ensureProgress(), which runs on every status fetch
 * and every claim, while comparing against last_claim_date — a date only
 * written when a mission is claimed. So each call on a day whose last claim was
 * yesterday stepped the streak again: four missions a day meant four days of
 * streak, and just opening the app did it too. A user reported hitting the
 * 50-credit bonus three times in one week; 19 of 573 live streaks were ahead of
 * their own cycle start, two at day 7 on day zero.
 *
 *   node --env-file=.env --import tsx scripts/test-streak.mts
 */
process.env.RESEND_API_KEY = "";

import jwt from "jsonwebtoken";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const API = "https://api.gltch.app/api/daily-missions";
const EMAIL = "streaktest@example.test";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};

async function cleanup() {
  const ids = ((await sql`SELECT id FROM users WHERE email = ${EMAIL}`) as any[]).map((r) => r.id);
  if (ids.length) {
    await sql`DELETE FROM daily_mission_claims WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM daily_mission_progress WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM karma_events WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM one_time_claims WHERE user_id = ANY(${ids}::uuid[])`;
  }
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
}

const state = async (id: string) =>
  ((await sql`SELECT streak_day, cycle_start, last_claim_date, streak_bonus_claimed
     FROM daily_mission_progress WHERE user_id = ${id}::uuid`) as any[])[0];

await cleanup();
try {
  // Daily missions are subscriber-gated, so the fixture has to be one.
  const [u] = (await sql`INSERT INTO users (email, password_hash, email_verified, pack_credits, subscription_tier)
    VALUES (${EMAIL}, 'x', true, 0, 'basic') RETURNING id`) as any[];
  const id = String(u.id);
  const token = jwt.sign({ userId: id, email: EMAIL }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const call = (body: any) => fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then((r) => r.json().then((j) => ({ status: r.status, body: j })));
  const status = () => fetch(API, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  /**
   * Pretend a day went by. The claim rows move too — otherwise the next day's
   * claim is refused as "already claimed today" and nothing advances, which is
   * a property of the test rig rather than of the streak.
   */
  const rewind = async (days: number) => {
    await sql`UPDATE daily_mission_progress
        SET last_claim_date = last_claim_date - (${days}::int),
            cycle_start     = cycle_start - (${days}::int)
        WHERE user_id = ${id}::uuid`;
    await sql`UPDATE daily_mission_claims SET claim_date = claim_date - (${days}::int)
        WHERE user_id = ${id}::uuid`;
    await sql`DELETE FROM karma_events WHERE user_id = ${id}::uuid`;
    await sql`DELETE FROM one_time_claims WHERE user_id = ${id}::uuid`;
  };

  console.log("── one claim, one day ──");
  const first = await call({ mission: "login" });
  if (first.status !== 200) console.log(`  (claim said ${first.status}: ${JSON.stringify(first.body).slice(0, 90)})`);
  ok("first claim starts the streak at day 1", (await state(id))?.streak_day === 1, `day ${(await state(id))?.streak_day}`);

  console.log("\n── the bug: more claims the same day ──");
  await call({ mission: "story" });
  await call({ mission: "share" });
  const sameDay = await state(id);
  ok("three claims in one day is still day 1", sameDay.streak_day === 1, `day ${sameDay.streak_day}`);

  console.log("\n── and just looking at the page ──");
  await status(); await status(); await status();
  ok("opening the app does not move the streak", (await state(id)).streak_day === 1);

  console.log("\n── a real next day ──");
  await rewind(1);
  await call({ mission: "login" });
  ok("the next day's claim makes it day 2", (await state(id)).streak_day === 2, `day ${(await state(id)).streak_day}`);
  await call({ mission: "story" });
  ok("a second claim that day keeps it at day 2", (await state(id)).streak_day === 2);

  console.log("\n── reaching the bonus ──");
  for (let d = 0; d < 5; d++) { await rewind(1); await call({ mission: "login" }); }
  const atSeven = await state(id);
  ok("seven days of claims reaches day 7", atSeven.streak_day === 7, `day ${atSeven.streak_day}`);
  const claim1 = await call({ mission: "streak_bonus" });
  ok("the bonus pays once", claim1.status === 200, JSON.stringify(claim1.body).slice(0, 60));
  const claim2 = await call({ mission: "streak_bonus" });
  ok("and refuses a second time", claim2.status !== 200, JSON.stringify(claim2.body).slice(0, 60));

  console.log("\n── missing a day ──");
  await rewind(3);
  await call({ mission: "login" });
  const afterGap = await state(id);
  ok("a broken run restarts at day 1", afterGap.streak_day === 1, `day ${afterGap.streak_day}`);
  ok("and the bonus is claimable again only after another full week", afterGap.streak_bonus_claimed === false);

  console.log("\n── the invariant that was violated in production ──");
  const st = await state(id);
  const elapsed = Math.floor((Date.now() - new Date(st.cycle_start).getTime()) / 86400000);
  ok("streak day never exceeds the days since the cycle began", st.streak_day <= elapsed + 1,
     `day ${st.streak_day} after ${elapsed} days`);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
