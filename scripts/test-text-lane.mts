/**
 * The text lane is a server-side filter, so the guarantee worth testing is that
 * `mediaType=text` returns text posts and ONLY text posts — and that it still
 * respects the SFW and lock rules the grid depends on.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

// tsx double-wraps the CJS/ESM interop default here, same as test-nsfw-gate.
const mod: any = await import("/home/neon/cyberpunk-grok-api/api/feed.ts");
const handler = mod.default?.default ?? mod.default;

const sql = getDb();
const P = "textlanetest";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

function mockRes() {
  const r: any = { statusCode: 200, body: null };
  r.setHeader = () => r;
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

async function getFeed(query: Record<string, string>, token?: string) {
  const req: any = {
    method: "GET",
    query,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

async function cleanup() {
  await sql`DELETE FROM feed_posts WHERE text LIKE ${P + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
}

await cleanup();

try {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified)
    VALUES (${`${P}@example.test`}, 'x', true) RETURNING id`;
  const userId = u.id as string;
  await sql`INSERT INTO profiles (user_id, username) VALUES (${userId}::uuid, ${P})
            ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username`;
  const token = signToken({ userId, email: `${P}@example.test` });

  // Four shapes: plain text, text+image, text+video, and mature text.
  const mk = async (text: string, imageUrl: string | null, mature = false) => {
    const [p] = await sql`
      INSERT INTO feed_posts (user_id, text, image_url, is_mature)
      VALUES (${userId}::uuid, ${text}, ${imageUrl}, ${mature}) RETURNING id`;
    return p.id as string;
  };
  const textId = await mk(`${P} plain text post`, null);
  const emptyStrId = await mk(`${P} empty-string image url`, "");
  const imgId = await mk(`${P} has an image`, "https://x.test/a.png");
  const vidId = await mk(`${P} has a video`, "https://x.test/a.mp4");
  const matureId = await mk(`${P} mature text`, null, true);
  // A post with media but no text must never surface in the text lane.
  const noTextId = await mk("", "https://x.test/b.png");

  const ids = (body: any) => new Set(body.posts.map((p: any) => p.id));

  console.log("\n── mediaType=text returns only text posts ──");
  // sfw is forced on for non-payers, so the mature one is expected to be absent.
  const textRes = await getFeed({ view: "posts", sort: "new", mediaType: "text" }, token);
  ok("responds 200", textRes.statusCode === 200, `got ${textRes.statusCode}`);
  const t = ids(textRes.body);
  ok("includes the plain text post", t.has(textId));
  ok("includes a post whose image_url is an empty string", t.has(emptyStrId));
  ok("excludes the image post", !t.has(imgId));
  ok("excludes the video post", !t.has(vidId));
  ok("excludes a media post with no caption", !t.has(noTextId));
  ok("every returned post has no media", textRes.body.posts.every((p: any) => !p.imageUrl));

  console.log("\n── the grid lane is unchanged ──");
  const allRes = await getFeed({ view: "posts", sort: "new" }, token);
  const a = ids(allRes.body);
  ok("still returns image posts", a.has(imgId));
  ok("still returns video posts", a.has(vidId));
  ok("still returns text posts", a.has(textId));

  console.log("\n── video lane still filters to video ──");
  const vidRes = await getFeed({ view: "posts", sort: "new", mediaType: "video" }, token);
  const v = ids(vidRes.body);
  ok("includes the video post", v.has(vidId));
  ok("excludes the image post", !v.has(imgId));
  ok("excludes text posts", !v.has(textId));

  console.log("\n── SFW still applies inside the text lane ──");
  ok("mature text post is filtered for a non-payer", !t.has(matureId));
  const sfwOff = await getFeed({ view: "posts", sort: "new", mediaType: "text", sfw: "0" }, token);
  ok("…and stays filtered when a non-payer asks for sfw=0",
    !ids(sfwOff.body).has(matureId), "server decides eligibility, not the query param");

  console.log("\n── logged-out ──");
  const anon = await getFeed({ view: "posts", sort: "new", mediaType: "text" });
  ok("public text lane responds 200", anon.statusCode === 200);
  ok("public text lane excludes mature", !ids(anon.body).has(matureId));
  ok("public text lane has no media", anon.body.posts.every((p: any) => !p.imageUrl));
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
