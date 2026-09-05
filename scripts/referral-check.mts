/**
 * Does referral attribution actually survive the whole chain?
 *
 * Referrals were 52-65% of signups until 19 April, then stopped. Three separate
 * breaks: the /r/:code route did not exist, the code was not persisted across
 * SPA navigation (both fixed in 9a0583f), and netlify.toml dropped ?ref= at the
 * share-page proxy (fixed in 1a2acfe). Each one was individually silent — the
 * feature looked fine and simply never attributed anything.
 *
 * So this walks the hops a real referral takes rather than testing any single
 * unit, because every one of those bugs lived in the seams.
 *
 *   node --env-file=.env --import tsx scripts/referral-check.mts
 *   node --env-file=.env --import tsx scripts/referral-check.mts --full
 *
 * Default run is read-only. --full additionally registers a throwaway account
 * through the real signup endpoint, asserts the referrals row appears, and
 * deletes it again. That sends one verification email, which is why it is not
 * the default.
 */
process.env.RESEND_API_KEY = "";

import { randomBytes } from "crypto";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const SITE = "https://grokrunner.gltch.app";
const API = "https://api.gltch.app";
const FULL = process.argv.includes("--full");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
  return ok;
};

const text = (url: string) =>
  fetch(url, { redirect: "follow" }).then((r) => r.text()).catch(() => "");

// A real share id, because share-page 404s on a made-up one and a 404 would
// pass a naive "no ref links" assertion for the wrong reason.
const [share] = await sql`
  SELECT share_id FROM share_owners ORDER BY created_at DESC LIMIT 1` as any[];
if (!share) { console.log("no share links exist yet — cannot test the share hop"); process.exit(1); }

const CODE = "TESTCODE99";
const refLinks = (html: string) => (html.match(/href="[^"]*[?&]ref=[^"]*"/g) || []).length;

console.log(`share id ${share.share_id}\n`);

// ── hop 1: the proxy ────────────────────────────────────────────────────
const viaProxy = await text(`${SITE}/s/${share.share_id}?ref=${CODE}`);
const direct = await text(`${API}/api/share-page?id=${share.share_id}&ref=${CODE}`);

check("share-page itself threads ref into its CTAs", refLinks(direct) > 0,
  `${refLinks(direct)} links`);
check("ref survives the Netlify proxy", refLinks(viaProxy) > 0,
  `${refLinks(viaProxy)} links` + (refLinks(viaProxy) === 0 ? " (deploy may still be running)" : ""));
check("the code carried through is the one sent", viaProxy.includes(`ref=${CODE}`));

// The ref rule only matches when the param is present, so a share posted
// without one needs the twin rule beneath it. Easy to lose in a reorder.
const noRef = await text(`${SITE}/s/${share.share_id}`);
check("plain share links still render", noRef.includes("GLTCH") && noRef.length > 500,
  `${noRef.length} bytes`);

// ── hop 2: /r/CODE reaches the SPA rather than a 404 ────────────────────
const rLanding = await text(`${SITE}/r/${CODE}`);
check("/r/:code serves the app shell", rLanding.includes("<div id=\"root\"") || rLanding.includes("<script"),
  `${rLanding.length} bytes`);

// ── hop 3: the backend can resolve a real code ──────────────────────────
// Mirrors the lookup in api/auth/signup.ts exactly.
const [owner] = await sql`
  SELECT referral_code FROM users
  WHERE referral_code IS NOT NULL AND referral_code <> '' LIMIT 1` as any[];
if (owner) {
  const rows = await sql`
    SELECT id, email FROM users WHERE referral_code = ${String(owner.referral_code).trim().toUpperCase()}
  ` as any[];
  check("a real referral code resolves to its owner", rows.length === 1,
    `${owner.referral_code} → ${rows.length} user(s)`);
} else {
  check("users have referral codes at all", false, "none found");
}

// ── hop 4: full signup round-trip (opt-in) ──────────────────────────────
if (FULL && owner) {
  // Signup is captcha-gated. Request a real challenge and answer it the way the
  // form does, rather than reaching past the gate — if the captcha ever starts
  // rejecting legitimate answers, this test should fail too.
  const ch = await fetch(`${API}/api/auth/captcha`).then((r) => r.json()) as any;
  const q: string = ch.question || "";
  let answer = "";
  let m: RegExpMatchArray | null;
  if ((m = q.match(/What is (\d+) \+ (\d+)/))) answer = String(+m[1] + +m[2]);
  else if ((m = q.match(/What is (\d+) - (\d+)/))) answer = String(+m[1] - +m[2]);
  else if ((m = q.match(/reverse: "(\w+)"/))) answer = m[1].split("").reverse().join("");
  if (!check("captcha challenge is answerable", !!answer, q)) {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  const email = `reftest-${randomBytes(6).toString("hex")}@gltch.app`;
  const res = await fetch(`${API}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email, password: randomBytes(16).toString("hex"),
      referral_code: owner.referral_code,
      captcha_token: ch.token, captcha_answer: answer,
    }),
  });
  const body = await res.json().catch(() => ({})) as any;

  const [created] = await sql`SELECT id, referred_by FROM users WHERE email = ${email}` as any[];

  // signup.ts requires a device fingerprint precisely so that scripts cannot
  // create accounts (see the July 2026 farming wave in its comment). Hitting
  // that wall is the guard working, not a referral bug — and fabricating a
  // fingerprint here would leave a working scripted-signup recipe in the repo.
  // So the last hop is verified by hand; everything up to it is covered above.
  if (!created && /web app to create an account/i.test(String(body.error || ""))) {
    check("scripted signup is refused, as designed", true, "fingerprint gate held");
    console.log(`
  The final hop — signup writes a referrals row — has to be done in a browser:

    1. open  ${SITE}/r/${owner.referral_code}
    2. register a throwaway account, verify it
    3. re-run with --recent to confirm the row landed`);
  } else {
    check("signup with a referral code creates the account", !!created,
      `${res.status} ${body.error || ""}`);
    if (created) {
      check("users.referred_by is stamped", !!created.referred_by);
      const [row] = await sql`SELECT id FROM referrals WHERE referee_id = ${created.id}::uuid` as any[];
      check("a referrals row is written", !!row);

      await sql`DELETE FROM referrals WHERE referee_id = ${created.id}::uuid`;
      await sql`DELETE FROM users WHERE id = ${created.id}::uuid`;
      const [gone] = await sql`SELECT id FROM users WHERE id = ${created.id}::uuid` as any[];
      check("test account cleaned up", !gone);
    }
  }
} else if (!FULL) {
  console.log("\n  (skipped the signup round-trip — pass --full to run it)");
}

// What actually landed, for confirming a manual test or watching it recover.
if (process.argv.includes("--recent") || FULL) {
  const recent = await sql`
    SELECT r.created_at, ru.email AS referrer, eu.email AS referee
    FROM referrals r
    LEFT JOIN users ru ON ru.id = r.referrer_id
    LEFT JOIN users eu ON eu.id = r.referee_id
    ORDER BY r.created_at DESC LIMIT 5` as any[];
  console.log(`\nmost recent referrals:`);
  if (!recent.length) console.log("  (none)");
  for (const r of recent) {
    console.log(`  ${String(r.created_at).slice(0, 19)}  ${String(r.referrer).slice(0, 26).padEnd(26)} → ${String(r.referee).slice(0, 26)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
