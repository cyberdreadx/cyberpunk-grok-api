/**
 * Send LongLook's exact workflow to its endpoint and print what comes back.
 *
 * The app only ever sees "COMPLETED with an empty output object", which says
 * nothing about why. This submits the same graph the app builds and dumps the
 * raw RunPod response, including whatever the worker put in `error`.
 *
 * Costs one small render (17 frames at 480x480, 4 steps).
 *
 *   node --env-file=.env --import tsx scripts/diagnose-longlook.mts
 */
process.env.RESEND_API_KEY = "";

import sharp from "sharp";
import { buildLongLookWorkflow } from "/home/neon/cyberpunk-grok-api/api/comfyui.ts";

const ENDPOINT = process.env.RUNPOD_LONGLOOK_ENDPOINT_ID || "9oo8i5tzekmok9";
const KEY = process.env.RUNPOD_API_KEY!;
const BASE = "https://api.runpod.ai/v2";

const img = await sharp({
  create: { width: 512, height: 512, channels: 3, background: { r: 90, g: 60, b: 120 } },
}).jpeg().toBuffer();

const workflow = buildLongLookWorkflow({
  prompts: (process.env.DIAG_SEQ === "4"
    ? ["a slow push in", "she turns her head", "she smiles", "the camera pulls back"]
    : ["a slow cinematic push in, soft light"]),
  negativePrompt: "blurry, low quality",
  imageFilename: "input_longlook_diag.jpg",
  width: 480,
  height: 480,
  seed: 12345,
  steps: 4,
  cfg: 1,
  frameCount: Number(process.env.DIAG_FRAMES || 17),
  useRife: false,
  useUpscale: false,
});

const nodeTypes = Object.entries(workflow).map(([id, n]: any) => `${id}:${n.class_type}`);
console.log(`sequences=${process.env.DIAG_SEQ === "4" ? 4 : 1} · frames=${process.env.DIAG_FRAMES || 17} · workflow has ${nodeTypes.length} nodes`);
console.log("node types:", [...new Set(Object.values(workflow).map((n: any) => n.class_type))].join(", "));

const run = await fetch(`${BASE}/${ENDPOINT}/run`, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    input: { workflow, images: [{ name: "input_longlook_diag.jpg", image: img.toString("base64") }] },
  }),
});
const submitted = await run.json();
console.log(`\nsubmit → http ${run.status}`, JSON.stringify(submitted).slice(0, 200));
const id = submitted.id;
if (!id) process.exit(1);

const started = Date.now();
let last = "";
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await fetch(`${BASE}/${ENDPOINT}/status/${id}`, { headers: { Authorization: `Bearer ${KEY}` } });
  const d: any = await s.json();
  if (d.status !== last) {
    console.log(`  ${Math.round((Date.now() - started) / 1000)}s · ${d.status}`);
    last = d.status;
  }
  if (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(d.status)) {
    console.log(`\nfinal status: ${d.status} after ${Math.round((Date.now() - started) / 1000)}s`);
    console.log("output keys:", JSON.stringify(Object.keys(d.output ?? {})));
    const dump = JSON.stringify(d, (k, v) =>
      typeof v === "string" && v.length > 400 ? `${v.slice(0, 400)}…[${v.length} chars]` : v, 1);
    console.log(dump.slice(0, 4000));
    process.exit(0);
  }
}
console.log("gave up waiting");
