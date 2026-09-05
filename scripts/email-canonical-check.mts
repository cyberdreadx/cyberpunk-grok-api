/**
 * canonicalEmail / sameMailbox behaviour.
 *
 * This decides who gets paid: it gates legacy referral credits and ambassador
 * cash commission. A false positive silently denies a real referrer their
 * money, which is worse than the farming it prevents — so the negative cases
 * below matter more than the positive ones.
 *
 *   node --env-file=.env --import tsx scripts/email-canonical-check.mts
 */
import { canonicalEmail, sameMailbox } from "/home/neon/cyberpunk-grok-api/api/_lib/email-canonical.ts";

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = got === want;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

console.log("same mailbox (must be caught):");
eq("plus tag on gmail", sameMailbox("alice@gmail.com", "alice+ref@gmail.com"), true);
eq("dots on gmail", sameMailbox("alice.smith@gmail.com", "alicesmith@gmail.com"), true);
eq("dots and plus together", sameMailbox("a.l.i.c.e@gmail.com", "alice+x@gmail.com"), true);
eq("googlemail alias", sameMailbox("alice@googlemail.com", "alice@gmail.com"), true);
eq("case and whitespace", sameMailbox("  Alice@Gmail.com ", "alice@gmail.com"), true);
eq("plus tag on outlook", sameMailbox("bob@outlook.com", "bob+promo@outlook.com"), true);
eq("plus tag on a custom domain", sameMailbox("x@mydomain.io", "x+1@mydomain.io"), true);

console.log("\ndistinct people (must NOT be caught):");
eq("different locals", sameMailbox("alice@gmail.com", "bob@gmail.com"), false);
eq("different domains", sameMailbox("alice@gmail.com", "alice@yahoo.com"), false);
// Only Gmail-family providers ignore dots. Collapsing them everywhere would
// merge two genuinely separate Fastmail users.
eq("dots on a non-gmail domain stay significant",
  sameMailbox("first.last@fastmail.com", "firstlast@fastmail.com"), false);
eq("dots on a custom domain stay significant",
  sameMailbox("a.b@company.co", "ab@company.co"), false);
eq("substring is not a match", sameMailbox("alice@gmail.com", "alice2@gmail.com"), false);

console.log("\nmalformed input must never match everything:");
eq("empty vs empty local", sameMailbox("", ""), true);   // literal fallback
eq("garbage vs real", sameMailbox("not-an-email", "alice@gmail.com"), false);
eq("two different garbage values", sameMailbox("xxx", "yyy"), false);
eq("null vs real", sameMailbox(null, "alice@gmail.com"), false);
eq("tag-only local canonicalises to nothing", canonicalEmail("+tag@gmail.com"), "");
eq("no at-sign canonicalises to nothing", canonicalEmail("alice.gmail.com"), "");
eq("trailing at canonicalises to nothing", canonicalEmail("alice@"), "");
// Two unparseable-but-different addresses must not collapse into one match.
eq("bare plus addresses do not match each other",
  sameMailbox("+a@gmail.com", "+b@gmail.com"), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
