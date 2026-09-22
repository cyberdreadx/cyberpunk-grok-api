/**
 * mx-blocklist: catches a rotating throwaway service by its mail host, and never
 * blocks anything else — including the shared host that 15 paying customers use.
 *
 *   node --import tsx scripts/test-mx-blocklist.mts
 */
import { isBlockedMxHost, isDisposableByMx } from "/home/neon/cyberpunk-grok-api/api/_lib/mx-blocklist.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${d ? `  ${d}` : ""}`);
};

console.log("── host matching ──");
ok("matches the disposable service exactly", isBlockedMxHost("10minutemail.com"));
ok("matches its subdomain", isBlockedMxHost("prd-smtp.10minutemail.com"));
ok("matches with a trailing dot and caps", isBlockedMxHost("PRD-SMTP.10MinuteMail.com."));
ok("does NOT match the shared host paying customers use", !isBlockedMxHost("mail.wallywatts.com"));
ok("does NOT match the other shared host", !isBlockedMxHost("mail.wabblywabble.com"));
ok("does NOT match a lookalike suffix", !isBlockedMxHost("not10minutemail.com"));
ok("does NOT match Google", !isBlockedMxHost("aspmx.l.google.com"));

console.log("\n── live lookups ──");
ok("blocks a domain served by the disposable host (gonrr.net)", await isDisposableByMx("x@gonrr.net"));
ok("blocks its rotated twin (vtmpj.com)", await isDisposableByMx("x@vtmpj.com"));
ok("allows a paying customer's domain on the shared host (4heats.com)", !(await isDisposableByMx("x@4heats.com")));
ok("allows gmail", !(await isDisposableByMx("x@gmail.com")));
ok("fails open on a domain that cannot resolve", !(await isDisposableByMx("x@definitely-not-a-real-domain-zzq.invalid")));
ok("fails open on a malformed address", !(await isDisposableByMx("not-an-email")));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
