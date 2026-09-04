/**
 * Generate photorealistic hero candidates for the landing page, on GLTCH itself.
 *
 * The hero is currently untextured extruded boxes in three.js, which reads as a
 * diagram of a city rather than a city. Stock photography would mean a licence
 * and an outside dependency; the platform already makes exactly this kind of
 * image, so the landing page can be made of the product it is selling.
 *
 * Prompts lean on photographic language — film stock, focal length, exposure —
 * because asking for "cyberpunk city" gets the same illustrated look the
 * three.js scene already has. Two shapes: 16:9 for desktop, 9:16 for mobile,
 * because a landscape skyline centre-cropped to a phone loses the skyline.
 *
 *   node --env-file=.env --import tsx scripts/landing-hero.mts
 *
 * 3 credits each.
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const OUT = "/tmp/gltch-work";

const LOOK =
  "photorealistic night cityscape, dense high-rise skyline, glowing cyan and "
  + "magenta neon signage on the towers, wet asphalt with long reflected light "
  + "trails, light rain and low haze, shot on 35mm film, anamorphic lens, long "
  + "exposure, shallow depth of field, cinematic colour grade, deep shadows, "
  + "no people, no text, no logos";

const SHOTS = [
  { id: "desk-a", w: 1344, h: 768, extra: "wide establishing shot from a rooftop, horizon low, sky filling the top third" },
  { id: "desk-b", w: 1344, h: 768, extra: "aerial drone view looking down a canyon of skyscrapers, vanishing point centre" },
  { id: "mob-a", w: 768, h: 1344, extra: "looking straight up a narrow street between towers, neon receding into fog" },
  { id: "mob-b", w: 768, h: 1344, extra: "tall vertical composition, one illuminated tower dominant, city falling away below" },
];

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
console.log(`${owner.email}, ${owner.credits} credits · ${SHOTS.length} candidates\n`);

const post = (body: any) =>
  fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).then((r) => r.json()).catch(() => ({})) as Promise<any>;

for (const shot of SHOTS) {
  const sub = await post({
    action: "generate", workflow: "zimage",
    prompt: `${shot.extra}, ${LOOK}`,
    width: shot.w, height: shot.h, steps: 8, cfg: 1,
  });
  if (!sub.promptId) { console.log(`${shot.id}: submit failed`); continue; }
  process.stdout.write(`${shot.id} `);

  let out: any = null;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    // Submit's endpoint must be echoed back or the status lookup 404s.
    const p = await post({
      action: "poll", promptId: sub.promptId, outputType: "image",
      runpodEndpointId: sub.runpodEndpointId,
    });
    if (p.error) break;
    if (p.status === "done" || p.image) { out = p; break; }
    process.stdout.write(".");
  }
  const url = out?.image || out?.previewUrl;
  if (!url) { console.log(" no output"); continue; }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(`${OUT}/hero-${shot.id}.png`, buf);
  console.log(` ${shot.w}x${shot.h}  ${Math.round(buf.length / 1024)} KB`);
}
console.log(`\nsaved to ${OUT}/hero-*.png`);
process.exit(0);
