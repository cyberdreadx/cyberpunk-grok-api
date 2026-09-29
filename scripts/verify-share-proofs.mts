/**
 * Did a social-proof claim actually link to us?
 *
 * The daily mission paid 10-25 credits for a URL and checked only its SHAPE —
 * that it looked like a reddit.com/comments/... or x.com/user/status/... link.
 * 111,140 credits (~$1,970 of GPU) went out on that basis.
 *
 * Twitter can be checked: publish.twitter.com/oembed returns the tweet's HTML
 * without auth. Links inside are t.co-shortened, so each is resolved to its
 * destination before looking for our domains.
 *
 * Reddit CANNOT be checked from this server — every .json request returns 403
 * (datacenter IPs are blocked), which also means verifyRedditPost() in
 * daily-missions.ts has been soft-failing open and verifying nothing.
 *
 *   node --env-file=.env --import tsx scripts/verify-share-proofs.mts [limit]
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const LIMIT = Number(process.argv[2]) || 150;
const OURS = /(gltchrunner\.com|grokrunner\.gltch\.app|gltch\.app)/i;

async function resolve(url: string): Promise<string> {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
    return r.url || url;
  } catch { return url; }
}

/** true = links to us, false = does not, null = could not tell */
async function tweetMentionsUs(url: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`,
      { redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;                       // deleted, private, or rate-limited
    const data: any = await r.json();
    const html = String(data?.html || "");
    if (OURS.test(html)) return true;
    const shortlinks = [...html.matchAll(/https:\/\/t\.co\/[A-Za-z0-9]+/g)].map((m) => m[0]);
    for (const s of shortlinks.slice(0, 4)) {
      if (OURS.test(await resolve(s))) return true;
    }
    return false;
  } catch { return null; }
}

/*
 * Verdicts are persisted so this is resumable and auditable: a clawback has to
 * be able to show its working, and re-checking 4,754 tweets after a rate-limit
 * would otherwise start from zero.
 */
await sql`
  CREATE TABLE IF NOT EXISTS share_proof_verdicts (
    -- daily_share_proofs.id is a uuid; typing this bigint made every lookup
    -- fail with "no operator matches", and the run died before its first write.
    proof_id   uuid PRIMARY KEY,
    user_id    uuid NOT NULL,
    url        text NOT NULL,
    links_to_us boolean,
    checked_at timestamptz NOT NULL DEFAULT now()
  )`;

const rows = (await sql`
  SELECT sp.id, sp.user_id, sp.url, sp.claim_date, u.email
  FROM daily_share_proofs sp JOIN users u ON u.id = sp.user_id
  WHERE sp.platform = 'twitter'
    AND NOT EXISTS (SELECT 1 FROM share_proof_verdicts v WHERE v.proof_id = sp.id AND v.links_to_us IS NOT NULL)
  ORDER BY sp.created_at DESC
  LIMIT ${LIMIT}`) as any[];

let linksToUs = 0, doesNot = 0, unknown = 0;
const bad: any[] = [];
let i = 0;
const workers = Array.from({ length: 5 }, async () => {
  while (i < rows.length) {
    const row = rows[i++];
    const verdict = await tweetMentionsUs(row.url);
    if (verdict === true) linksToUs++;
    else if (verdict === false) { doesNot++; bad.push(row); }
    else unknown++;
    await sql`
      INSERT INTO share_proof_verdicts (proof_id, user_id, url, links_to_us)
      VALUES (${row.id}::uuid, ${row.user_id}::uuid, ${row.url}, ${verdict})
      ON CONFLICT (proof_id) DO UPDATE SET links_to_us = EXCLUDED.links_to_us, checked_at = now()`;
  }
});
await Promise.all(workers);

console.log(`checked ${rows.length} of the most recent Twitter claims:`);
console.log(`  links to us:        ${linksToUs}`);
console.log(`  does NOT link:      ${doesNot}`);
console.log(`  unverifiable:       ${unknown}  (deleted, private, or rate-limited — never counted against anyone)`);
if (bad.length) {
  console.log("\n  examples that do not link to us:");
  for (const b of bad.slice(0, 5)) console.log(`    ${b.email} · ${b.claim_date?.toString?.().slice(0, 10)} · ${b.url}`);
}
