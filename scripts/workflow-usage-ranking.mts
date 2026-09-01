/**
 * Which workflows do people actually run? The public API exposes three
 * (klein, txt2img, wan-video); the app runs about eight. This ranks them so
 * v1 can carry the ones that matter instead of the ones that happened to be
 * written first.
 *
 * Refund rows are folded back into their parent so a workflow isn't counted
 * twice, and success rate is reported separately.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

for (const days of [30, 90]) {
  const rows = await sql`
    SELECT
      regexp_replace(mode, '^comfy-|-refunded.*$', '', 'g') AS workflow,
      count(*) FILTER (WHERE mode NOT LIKE '%refunded%') AS ok,
      count(*) FILTER (WHERE mode LIKE '%refunded%')      AS refunded,
      count(DISTINCT user_id)                             AS users
    FROM usage_log
    WHERE mode LIKE 'comfy-%'
      AND created_at > now() - (${days} || ' days')::interval
    GROUP BY 1
    ORDER BY ok DESC`;

  const total = rows.reduce((s: number, r: any) => s + Number(r.ok), 0);
  console.log(`\n── last ${days} days (${total.toLocaleString()} successful jobs) ──`);
  console.log("  workflow          jobs     share  users  fail%   in v1?");
  const IN_V1 = new Set(["klein", "txt2img", "wan-video"]);
  for (const r of rows) {
    const ok = Number(r.ok), ref = Number(r.refunded);
    const share = total ? ((ok / total) * 100).toFixed(1) : "0.0";
    const failPct = ok + ref ? ((ref / (ok + ref)) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${String(r.workflow).padEnd(15)} ${String(ok).padStart(6)}  ${share.padStart(6)}%  ${String(r.users).padStart(5)}  ${failPct.padStart(5)}%   ${IN_V1.has(r.workflow) ? "yes" : "NO"}`,
    );
  }
}

process.exit(0);
