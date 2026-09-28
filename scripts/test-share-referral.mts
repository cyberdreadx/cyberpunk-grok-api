/**
 * Share pages carry their owner's referral code.
 *
 * 418 people a day arrive on these pages from Reddit and X and every CTA sent
 * them in anonymously. Attribution is what turns that traffic into the guarded
 * activation reward instead of a new, farmable faucet.
 *
 *   node --env-file=.env --import tsx scripts/test-share-referral.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const P = "sharereftest";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};

/**
 * The handler reads share metadata from R2 and ESM exports cannot be stubbed,
 * so the test writes real (tiny, disposable) metadata objects and deletes them
 * in the finally block. Keys are prefixed so they can never collide with a real
 * share.
 */
const r2 = await import("/home/neon/cyberpunk-grok-api/api/_lib/r2.ts");
const { uploadToR2, deleteR2Objects } = (r2 as any).default ?? r2;
const handler = (await import("/home/neon/cyberpunk-grok-api/api/share-page.ts")).default;

const TEST_SHARES = ["zzTestA1", "zzTestB2", "zzTestC3"];
async function seedMeta(shareId: string) {
  const body = Buffer.from(JSON.stringify({
    prompt: "a neon cat", mediaUrl: "https://pub-0a4d910130d047e9a9c0e03feb7fcca6.r2.dev/test.png",
    mediaType: "image", ext: "png",
  }));
  await uploadToR2(`shares/${shareId}.json`, body, "application/json");
}

async function render(shareId: string, query: Record<string, string> = {}) {
  let body = "";
  const res: any = {
    setHeader() {}, status() { return this; },
    send(b: string) { body = b; return this; },
  };
  await handler({ method: "GET", query: { id: shareId, ...query }, headers: {} } as any, res);
  return body;
}

async function mkOwner(tag: string, code: string | null, banned = false) {
  const [u] = (await sql`
    INSERT INTO users (email, password_hash, email_verified, referral_code)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true, ${code}) RETURNING id`) as any[];
  if (banned) await sql`INSERT INTO user_bans (user_id, reason) VALUES (${u.id}::uuid, 'share ref test')`;
  return String(u.id);
}
const mkShare = async (shareId: string, userId: string) =>
  sql`INSERT INTO share_owners (share_id, user_id, ext) VALUES (${shareId}, ${userId}::uuid, 'png')`;

async function cleanup() {
  const ids = ((await sql`SELECT id FROM users WHERE email LIKE ${P + "-%"}`) as any[]).map((r) => r.id);
  if (ids.length) {
    await sql`DELETE FROM share_owners WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM user_bans WHERE user_id = ANY(${ids}::uuid[])`;
  }
  await sql`DELETE FROM users WHERE email LIKE ${P + "-%"}`;
}

await cleanup();
try {
  for (const id of TEST_SHARES) await seedMeta(id);
  const owner = await mkOwner("owner", "SHARECODE1");
  await mkShare("zzTestA1", owner);
  const page = await render("zzTestA1");
  ok("a share page links back with the owner's code", page.includes("ref=SHARECODE1"), page.match(/ref=[A-Z0-9]+/)?.[0] ?? "no ref");
  // href values go through escapeHtml, so the separator renders as &amp;
  ok("the try-this-prompt link carries it too", /prompt=[^"]*(&|&amp;)ref=SHARECODE1/.test(page),
     page.match(/href="[^"]*prompt=[^"]{0,60}/)?.[0] ?? "no prompt link");

  const explicit = await render("zzTestA1", { ref: "SOMEONEELSE" });
  ok("an explicit ?ref= wins over the owner's", explicit.includes("ref=SOMEONEELSE") && !explicit.includes("ref=SHARECODE1"));

  const banned = await mkOwner("banned", "BANNEDCODE", true);
  await mkShare("zzTestB2", banned);
  const bannedPage = await render("zzTestB2");
  ok("a banned owner earns nothing from their links", !bannedPage.includes("BANNEDCODE"));
  ok("...but the page still renders", bannedPage.includes("GLTCH_RUNNER"));

  const noCode = await mkOwner("nocode", null);
  await mkShare("zzTestC3", noCode);
  const noCodePage = await render("zzTestC3");
  ok("an owner without a code just gets no attribution", !/[?&]ref=/.test(noCodePage));
  ok("...and that page renders too", noCodePage.includes("GLTCH_RUNNER"));

  const orphan = await render("zzTestD4");
  ok("a share with no owner row still renders", orphan.length > 200);
} finally {
  await cleanup();
  await deleteR2Objects(TEST_SHARES.map((id: string) => `shares/${id}.json`)).catch(() => {});
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
