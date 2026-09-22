/**
 * Which RunPod endpoint each engine talks to. Z-Image and Krea2 were merged onto
 * the Qwen endpoint on 2026-09-22; this pins that, and pins that nothing else moved.
 *
 *   node --env-file=.env --import tsx scripts/test-endpoint-routing.mts
 */
process.env.RESEND_API_KEY = "";
import { getRunPodEndpointForWorkflow } from "/home/neon/cyberpunk-grok-api/api/comfyui.ts";

const QWEN = process.env.RUNPOD_QWEN_EDIT_ENDPOINT_ID!;
const WAN = process.env.RUNPOD_WAN_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID!;
const LTX = process.env.RUNPOD_LTX_ENDPOINT_ID!;
const ZIMAGE_OLD = process.env.RUNPOD_ZIMAGE_ENDPOINT_ID || "(unset)";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${d ? `  ${d}` : ""}`);
};

console.log(`qwen=${QWEN} wan=${WAN} ltx=${LTX} old zimage=${ZIMAGE_OLD}\n`);
console.log("── merged onto the qwen pool ──");
ok("zimage → qwen endpoint", getRunPodEndpointForWorkflow("zimage") === QWEN, getRunPodEndpointForWorkflow("zimage"));
ok("krea2 → qwen endpoint", getRunPodEndpointForWorkflow("krea2") === QWEN, getRunPodEndpointForWorkflow("krea2"));
ok("qwen-edit stays on the qwen endpoint", getRunPodEndpointForWorkflow("qwen-edit") === QWEN);

console.log("\n── everything else is untouched ──");
ok("wan-video → wan endpoint", getRunPodEndpointForWorkflow("wan-video") === WAN, getRunPodEndpointForWorkflow("wan-video"));
ok("gltch-wan → wan endpoint", getRunPodEndpointForWorkflow("gltch-wan") === WAN);
ok("ltx-video → ltx endpoint", getRunPodEndpointForWorkflow("ltx-video") === LTX, getRunPodEndpointForWorkflow("ltx-video"));
ok("ltx-animate → ltx endpoint", getRunPodEndpointForWorkflow("ltx-animate") === LTX);
ok("longlook → its own or wan", !!getRunPodEndpointForWorkflow("longlook"));

console.log("\n── the escape hatch still works ──");
process.env.RUNPOD_ZIMAGE_DEDICATED = "1";
process.env.RUNPOD_ZIMAGE_ENDPOINT_ID = "zzz_dedicated";
ok("RUNPOD_ZIMAGE_DEDICATED=1 restores the separate endpoint", getRunPodEndpointForWorkflow("zimage") === "zzz_dedicated");
delete process.env.RUNPOD_ZIMAGE_DEDICATED;
ok("unset again → back on qwen", getRunPodEndpointForWorkflow("zimage") === QWEN);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
