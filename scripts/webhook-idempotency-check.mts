/**
 * Does a failed webhook event become retryable again?
 *
 * The bug: processed_events was written before the work, and left behind when
 * the work threw. Stripe's retry then hit the duplicate check and was dropped,
 * so any failure was permanent. Five events died that way in 14 days.
 *
 * The fix keeps the claim (two concurrent deliveries of one event must not both
 * process) but releases it when the handler fails. This exercises that against
 * the real table with a synthetic event id.
 *
 *   node --env-file=.env --import tsx scripts/webhook-idempotency-check.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const ID = `evt_test_${Date.now()}`;

let pass = 0, fail = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${got}, want ${want})`}`);
};

// Mirrors markEventProcessed / releaseEvent in api/webhook.ts.
async function claim(id: string): Promise<boolean> {
  try {
    await sql`INSERT INTO processed_events (event_id, processed_at) VALUES (${id}, now())`;
    return true;
  } catch (err: any) {
    if (err.message?.includes("unique") || err.code === "23505") return false;
    throw err;
  }
}
async function release(id: string): Promise<void> {
  await sql`DELETE FROM processed_events WHERE event_id = ${id}`;
}

try {
  check("first delivery claims the event", await claim(ID), true);
  check("concurrent duplicate is blocked", await claim(ID), false);

  // The handler throws here — this is where the old code stopped.
  await release(ID);

  check("Stripe's retry can now claim it", await claim(ID), true);
  check("...and is still protected against its own duplicate", await claim(ID), false);

  // Old behaviour, for contrast: without the release the retry is lost.
  const ID2 = ID + "_noRelease";
  await claim(ID2);
  check("without release, the retry is dropped (the old bug)", await claim(ID2), false);

  await release(ID);
  await release(ID2);
  const [left] = (await sql`
    SELECT COUNT(*)::int AS n FROM processed_events WHERE event_id LIKE ${ID + "%"}`) as any[];
  check("test rows cleaned up", left.n, 0);
} finally {
  await sql`DELETE FROM processed_events WHERE event_id LIKE ${"evt_test_%"}`;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
