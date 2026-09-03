/**
 * Prove the RENDER aspect presets reach the actual video, on both engines.
 *
 * LTX is direct — width/height go to buildLtxWorkflow, which rounds to 32.
 * COMFY is not: buildGltchWanWorkflow ignores the width and height it is
 * handed and takes the video's shape from resizing the Z-Image start frame
 * into a `resolution` x `resolution` box (ImageResizeKJv2, keep_proportion,
 * divisible_by 16). The claim under test is that a start frame already
 * carrying the ratio, plus the pair's long edge as `resolution`, reproduces
 * the pair exactly. That is read off the workflow, so it needs a render.
 *
 *   node --env-file=.env --import tsx scripts/render-aspect-check.mts [W] [H]
 *
 * Costs ~15 cr (comfy) + ~14 cr (ltx, held to the shortest preset).
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const W = Number(process.argv[2]) || 480;
const H = Number(process.argv[3]) || 832;
const PROMPT = "a woman in a red jacket walks toward camera down a rain-slick neon alley";

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });

const post = (body: any) =>
  fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).then((r) => r.json()).catch(() => ({})) as Promise<any>;

/** Submit, then poll until the job produces an image or a video. */
async function run(body: any, outputType: "image" | "video", budgetMs: number) {
  const sub = await post({ action: "generate", ...body });
  if (!sub.promptId) throw new Error(`submit failed: ${JSON.stringify(sub).slice(0, 300)}`);
  process.stdout.write(`  ${sub.promptId} on ${sub.runpodEndpointId} `);
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    // The submit response carries the endpoint it used; poll must echo it back
    // or the status lookup 404s against the wrong endpoint.
    const p = await post({
      action: "poll", promptId: sub.promptId, outputType,
      runpodEndpointId: sub.runpodEndpointId,
    });
    if (p.error) throw new Error(p.error);
    if (p.status === "done" || p.video || p.image) { console.log(); return p; }
    process.stdout.write(".");
  }
  throw new Error("timed out");
}

/** Real dimensions of the encoded video, straight from the stream header. */
function probe(file: string): string {
  return execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file,
  ]).toString().trim();
}

async function save(url: string, file: string) {
  writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return file;
}

console.log(`acting as ${owner.email}, ${owner.credits} credits`);
console.log(`target shape ${W}x${H}\n`);
const results: [string, string][] = [];

// ── COMFY: Z-Image start frame -> GLTCH WAN, exactly as comfyTextToVideo does
console.log("COMFY (Z-Image start frame -> WAN 2.2)");
const frame = await run(
  { workflow: "zimage", prompt: PROMPT, width: W, height: H, steps: 8, cfg: 1, skipCredits: true },
  "image", 180000,
);
if (!frame.image) throw new Error("no start frame");
const vid = await run({
  workflow: "gltch-wan", prompt: PROMPT,
  imageBase64: frame.image, imageFilename: "start_frame.png",
  width: W, height: H,
  resolution: Math.max(W, H), shift: 8,
  frameCount: 33, steps: 4, cfg: 1,
  useRife: true, useUpscale: true,
}, "video", 600000);
results.push(["comfy", probe(await save(vid.video || vid.image, `/tmp/gltch-work/render-comfy-${W}x${H}.mp4`))]);

// ── LTX: dimensions go straight to the builder
console.log("\nLTX-2.3");
const ltx = await run({
  workflow: "ltx-video", prompt: PROMPT,
  width: W, height: H, frameCount: 49, frameRate: 24, ltxAudio: false,
}, "video", 600000);
results.push(["ltx", probe(await save(ltx.video || ltx.image, `/tmp/gltch-work/render-ltx-${W}x${H}.mp4`))]);

console.log(`\nrequested ${W}x${H}`);
let ok = true;
for (const [name, got] of results) {
  const match = got === `${W}x${H}`;
  ok &&= match;
  console.log(`  ${name.padEnd(6)} -> ${got.padEnd(10)} ${match ? "MATCH" : "MISMATCH"}`);
}
process.exit(ok ? 0 : 1);
