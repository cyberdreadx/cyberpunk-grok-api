/**
 * Does each offered edit LoRA actually load?
 *
 * The edit dropdown is fed by COMFYUI_EDIT_LORAS || COMFYUI_QWEN_LORAS, and
 * that list still carries qwen-prefixed files — but the client sends
 * workflow:"klein", which the server builds as buildFlux2KleinEditWorkflow.
 * A Qwen-trained LoRA has different keys from Flux Klein, so it either throws
 * on load or applies nothing. Both are invisible to a user who just picked it
 * from a menu.
 *
 * Runs one real edit per LoRA plus a control with none, and reports which
 * come back. A file that errors is broken; a file that succeeds is fine
 * whatever its name suggests.
 *
 *   node --env-file=.env --import tsx scripts/edit-lora-check.mts
 *
 * 3 credits per entry.
 */
process.env.RESEND_API_KEY = "";

import { readFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const SRC = "/tmp/gltch-work/quant-q8-crop.png"; // any small image; content is irrelevant

const listed = (process.env.COMFYUI_EDIT_LORAS || process.env.COMFYUI_QWEN_LORAS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
if (!listed.length) { console.error("no edit LoRAs configured"); process.exit(1); }

const [owner] = await sql`
  SELECT id, email, daily_credits + sub_credits + pack_credits AS credits
  FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
const imageBase64 = readFileSync(SRC).toString("base64");
console.log(`${owner.email}, ${owner.credits} credits`);
console.log(`testing ${listed.length} LoRAs + 1 control against workflow "klein"\n`);

const post = (body: any) =>
  fetch(`${BASE}/api/comfyui`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) })) as Promise<any>;

async function tryLora(name: string | null): Promise<string> {
  const sub = await post({
    action: "generate", workflow: "klein",
    prompt: "make the lighting warmer",
    imageBase64, imageFilename: "probe.png",
    steps: 8, cfg: 5,
    ...(name ? { loras: [{ name, strengthModel: 0.3, strengthClip: 0.3 }] } : {}),
  });
  if (!sub.promptId) return `submit rejected: ${String(sub.error || JSON.stringify(sub)).slice(0, 120)}`;

  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    // Submit's endpoint must be echoed back or the status lookup 404s.
    const p = await post({
      action: "poll", promptId: sub.promptId, outputType: "image",
      runpodEndpointId: sub.runpodEndpointId,
    });
    if (p.error) return `FAILED: ${String(p.error).slice(0, 160)}`;
    if (p.status === "done" || p.image) return "ok";
  }
  return "timed out";
}

const control = await tryLora(null);
console.log(`${"(none — control)".padEnd(40)} ${control}`);
if (control !== "ok") {
  console.error("\nControl failed, so a LoRA result here would mean nothing. Stopping.");
  process.exit(1);
}

const broken: string[] = [];
for (const name of listed) {
  const res = await tryLora(name);
  console.log(`${name.padEnd(40)} ${res}`);
  if (res !== "ok") broken.push(name);
}

console.log(broken.length
  ? `\n${broken.length} of ${listed.length} do not load: ${broken.join(", ")}`
  : `\nall ${listed.length} load against the klein workflow`);
process.exit(0);
