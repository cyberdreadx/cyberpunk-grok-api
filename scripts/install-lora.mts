/**
 * Fetch a Civitai LoRA onto the RunPod network volume.
 *
 * Civitai returns 401 on model downloads without a token, and the volume is
 * only writable from a pod, so this resolves the version, checks the licence
 * and prints the exact commands to run on the pod rather than pretending it
 * can reach the volume itself.
 *
 * The licence check is not decoration. Civitai's `Rent` permission is the one
 * a paid generation service needs; `RentCivit` alone means Civitai's own
 * generator only. A model missing `Rent` can still be installed if its creator
 * has granted permission directly — but that grant lives outside the metadata,
 * so it has to be named on the command line and ends up recorded in .env
 * beside the file it authorises.
 *
 *   node --env-file=.env --import tsx scripts/install-lora.mts <modelId> [versionName] [--granted-by "who, when"]
 */
process.env.RESEND_API_KEY = "";

const [, , modelId, ...rest] = process.argv;
if (!modelId) {
  console.error("usage: install-lora.mts <modelId> [versionName] [--granted-by \"...\"]");
  process.exit(1);
}
const grantedIdx = rest.indexOf("--granted-by");
const grantedBy = grantedIdx >= 0 ? rest[grantedIdx + 1] : "";
const wantVersion = rest[0] && rest[0] !== "--granted-by" ? rest[0] : "";

const VOLUME = "/workspace/runpod-slim/ComfyUI/models/loras";

const r = await fetch(`https://civitai.com/api/v1/models/${modelId}`, { signal: AbortSignal.timeout(30000) });
if (!r.ok) { console.error(`civitai returned ${r.status}`); process.exit(1); }
const m = await r.json() as any;

console.log(`${m.name}  (${m.type})  by ${m.creator?.username}`);
const cu: string[] = m.allowCommercialUse || [];
const paidServiceOk = cu.includes("Rent") || cu.includes("Sell");
console.log(`licence: commercial=[${cu.join(", ")}] credit_required=${m.allowNoCredit === false} derivatives=${m.allowDerivatives}`);

if (!paidServiceOk && !grantedBy) {
  console.error(`\nREFUSING: this licence does not grant "Rent", which is what a paid`);
  console.error(`generation service needs. Either pick a model that does, or pass`);
  console.error(`--granted-by "creator, date" once you hold permission directly.`);
  process.exit(1);
}
if (!paidServiceOk) console.log(`permission held directly: ${grantedBy}`);

// Base models GLTCH can actually load a LoRA against.
const RUNNABLE: Record<string, string> = {
  "Flux.2 Klein 9B": "klein edit  (COMFYUI_EDIT_LORAS)",
  "Qwen": "qwen edit   (COMFYUI_QWEN_LORAS)",
};
const usable = (m.modelVersions || []).filter((v: any) => RUNNABLE[v.baseModel]);
if (!usable.length) {
  console.error(`\nNo version targets a base model GLTCH runs. Available: ${
    [...new Set((m.modelVersions || []).map((v: any) => v.baseModel))].join(", ")}`);
  process.exit(1);
}

const v = wantVersion
  ? usable.find((x: any) => x.name === wantVersion)
  : usable[0]; // newest first, as Civitai returns them
if (!v) { console.error(`version "${wantVersion}" not found among: ${usable.map((x: any) => x.name).join(", ")}`); process.exit(1); }

const file = (v.files || []).find((f: any) => f.type === "Model") || v.files?.[0];
if (!file) { console.error("version has no model file"); process.exit(1); }

console.log(`\nversion : ${v.name}  (${v.baseModel} -> ${RUNNABLE[v.baseModel]})`);
console.log(`file    : ${file.name}  ${(file.sizeKB / 1e6).toFixed(2)} GB`);
console.log(`sha256  : ${file.hashes?.SHA256 || "(none published)"}`);
if (v.trainedWords?.length) console.log(`triggers: ${v.trainedWords.join(", ")}`);

console.log(`\n── run on the pod ──────────────────────────────────────────`);
console.log(`cd ${VOLUME}`);
console.log(`curl -L -H "Authorization: Bearer $CIVITAI_TOKEN" \\`);
console.log(`  -o ${file.name}.partial "${file.downloadUrl}"`);
if (file.hashes?.SHA256) {
  console.log(`sha256sum ${file.name}.partial   # expect ${file.hashes.SHA256.toLowerCase()}`);
}
console.log(`mv ${file.name}.partial ${file.name}`);
console.log(`\n── then add to .env and restart ────────────────────────────`);
const key = v.baseModel === "Qwen" ? "COMFYUI_QWEN_LORAS" : "COMFYUI_EDIT_LORAS";
console.log(`# ${m.name} by ${m.creator?.username} — civitai.com/models/${modelId}`);
if (grantedBy) console.log(`# Licence grants ${cu.join("/") || "nothing"}; paid-service use permitted directly: ${grantedBy}`);
if (m.allowNoCredit === false) console.log(`# Attribution required by licence — credit ${m.creator?.username} where the LoRA is offered.`);
console.log(`${key}="...existing...,${file.name}"`);
console.log(`sudo systemctl restart grokrunner`);
process.exit(0);
