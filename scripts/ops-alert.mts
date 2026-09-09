/**
 * Ops alerting — the monitor that should have existed on 2026-09-06.
 *
 * That day a syntax error made every generation return 500 for 17h49m while
 * systemd happily reported the service "active (running)". The day after,
 * RunPod ran out of money twice and refused 46 jobs. Both times the only
 * monitor that fired was the owner noticing.
 *
 * Three checks, in the order they earn their keep:
 *
 *   api       A synthetic request to the generation endpoints, unauthenticated,
 *             asserting the answer is a 4xx and not a 5xx. This is the cheap one
 *             and it is the one that mattered: on 09-06 EVERY request 500'd, so
 *             this would have fired two minutes in with no users involved.
 *
 *   runpod    Balance divided by the real 7-day burn from usage_log.api_cost_cents.
 *             Warns on days of runway, not dollars, because the dollar figure
 *             means nothing without the burn rate beside it.
 *
 *   disputes  Open Stripe disputes, and the rolling 30-day rate against the
 *             payments in the same window. This is the blindest spot on the
 *             account: the dispute rate is what decides whether card
 *             processing keeps working at all, and the denominator here is
 *             small — 256 payments in August means two disputes is already
 *             0.78%. June 2026 hit 1.24% and nobody knew. Also surfaces the
 *             evidence deadline, because an unanswered dispute is auto-lost.
 *
 *   flatline  Generations against the same hour on previous days. Traffic here
 *             is spiky — the median gap between jobs is 30 seconds but the
 *             longest legitimate quiet spell in 30 days was 6.2 hours — so a
 *             flat threshold would cry wolf every few days and get muted inside
 *             a week. This one catches the subtle failure the probe cannot:
 *             endpoints answering 200 while nothing actually completes.
 *
 * Alerts fire on TRANSITION, not on every run, and re-fire only after
 * RENOTIFY_MS while a problem persists. A monitor that repeats itself every
 * minute gets muted, and a muted monitor is worse than none.
 *
 *   node --env-file=.env --import tsx scripts/ops-alert.mts [--dry] [--test]
 */
process.env.RESEND_API_KEY = "";

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const DRY = process.argv.includes("--dry");
const TEST = process.argv.includes("--test");

const WEBHOOK = process.env.DISCORD_ALERT_WEBHOOK || "";
const STATE_PATH = join(process.cwd(), "data", "ops-alert-state.json");

/** How long a problem stays quiet before it nags again. */
const RENOTIFY_MS = 6 * 60 * 60_000;

/** Consecutive failures before the API check speaks. One blip is not an outage. */
const API_STRIKES = 2;

/**
 * The API probe is a single HTTP request and runs every minute. The other two
 * checks hit Postgres, and the flatline baseline scans a week of usage_log with
 * EXTRACT(HOUR ...) — which no index can serve — so running it 1440 times a day
 * would cost far more than the thing it is watching. Ten minutes is well inside
 * the window that matters for a balance or a stall.
 */
const DB_CHECK_INTERVAL_MS = 10 * 60_000;

const RUNWAY_WARN_DAYS = 3;
const RUNWAY_CRIT_DAYS = 1;

/** Card-network thresholds. Stripe reviews well before Visa's programme. */
const DISPUTE_WARN_PCT = 0.75;
const DISPUTE_CRIT_PCT = 0.9;
/** Statuses that still need something from us. */
const DISPUTE_OPEN = new Set([
  "warning_needs_response", "warning_under_review", "needs_response", "under_review",
]);

/** Quiet spell before flatline is even considered, in minutes. */
const FLATLINE_MIN = 45;
/** ...and only if this hour normally does at least this many generations. */
const FLATLINE_EXPECT = 8;

type Sev = "ok" | "warn" | "crit";
interface Check { key: string; sev: Sev; title: string; detail: string }

interface State { [key: string]: { sev: Sev; since: number; notified: number; strikes?: number } }

function loadState(): State {
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch { return {}; }
}
function saveState(s: State) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
  } catch (e: any) {
    console.error("[ops-alert] could not persist state:", e.message);
  }
}

const COLOR: Record<Sev, number> = { ok: 0x34d399, warn: 0xfbbf24, crit: 0xef4444 };
const ICON: Record<Sev, string> = { ok: "✅", warn: "⚠️", crit: "🚨" };

async function post(sev: Sev, title: string, detail: string): Promise<void> {
  if (!WEBHOOK) { console.log("(no DISCORD_ALERT_WEBHOOK set)"); return; }
  if (DRY) { console.log(`[dry] would post: ${ICON[sev]} ${title}\n${detail}`); return; }
  try {
    const r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "GLTCH Ops",
        embeds: [{
          title: `${ICON[sev]} ${title}`,
          description: detail,
          color: COLOR[sev],
          footer: { text: "gltch ops · scripts/ops-alert.mts" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!r.ok) console.error(`[ops-alert] discord returned ${r.status}`);
  } catch (e: any) {
    console.error("[ops-alert] discord post failed:", e.message);
  }
}

// ── check: are the generation endpoints answering at all? ──────────────────
async function checkApi(state: State): Promise<Check> {
  const targets = ["https://api.gltch.app/api/comfyui", "https://api.gltch.app/api/generate"];
  const bad: string[] = [];

  for (const url of targets) {
    try {
      const ctl = AbortSignal.timeout(15_000);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: ctl,
      });
      // 401/400 is a healthy handler refusing an unauthenticated request.
      // 5xx means the handler is broken, which is exactly the 09-06 failure.
      if (r.status >= 500) bad.push(`${url.split("/").pop()} → ${r.status}`);
    } catch (e: any) {
      bad.push(`${url.split("/").pop()} → ${e.name === "TimeoutError" ? "timeout" : e.message}`);
    }
  }

  const prev = state.api?.strikes ?? 0;
  const strikes = bad.length ? prev + 1 : 0;
  state.api = { ...(state.api ?? { sev: "ok", since: Date.now(), notified: 0 }), strikes };

  if (bad.length && strikes >= API_STRIKES) {
    return {
      key: "api", sev: "crit",
      title: "Generation API is failing",
      detail: `Endpoints returning 5xx for ${strikes} consecutive checks:\n\`\`\`\n${bad.join("\n")}\n\`\`\`\n` +
        "A 4xx here is healthy — it means the handler ran and refused an unauthenticated request. " +
        "A 5xx means the handler itself is broken, and every real user request is failing too.\n" +
        "`journalctl -u grokrunner -n 50`",
    };
  }
  return { key: "api", sev: "ok", title: "Generation API healthy", detail: "Endpoints answering normally again." };
}

// ── check: how many days of GPU money is left? ─────────────────────────────
async function checkRunpod(sql: any): Promise<Check | null> {
  const key = process.env.RUNPOD_ACCOUNT_API_KEY;
  if (!key) return null;

  let balance: number;
  try {
    const r = await fetch(`https://api.runpod.io/graphql?api_key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { myself { clientBalance } }" }),
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await r.json();
    balance = Number(j?.data?.myself?.clientBalance);
    if (!Number.isFinite(balance)) return null;
  } catch {
    return null; // never let a RunPod API blip masquerade as an outage
  }

  // Real burn from what we actually paid, not an estimate.
  const [b] = await sql`
    SELECT COALESCE(SUM(api_cost_cents), 0) / 100.0 / 7.0 AS per_day
    FROM usage_log
    WHERE created_at >= now() - interval '7 days' AND api_cost_cents > 0`;
  const perDay = Number(b?.per_day) || 0;
  if (perDay <= 0) return null;

  const days = balance / perDay;
  const empty = new Date(Date.now() + days * 86_400_000);
  const detail =
    `Balance **$${balance.toFixed(2)}** · burn **$${perDay.toFixed(2)}/day** (real 7-day average)\n` +
    `Runway **${days.toFixed(1)} days** — empty around **${empty.toUTCString().slice(0, 22)} UTC**\n\n` +
    `When this hits zero the GPU refuses jobs and users get failures. ` +
    `On 2026-09-07 that was 46 refused jobs across 8 users.`;

  if (days <= RUNWAY_CRIT_DAYS) return { key: "runpod", sev: "crit", title: "RunPod nearly out of money", detail };
  if (days <= RUNWAY_WARN_DAYS) return { key: "runpod", sev: "warn", title: "RunPod balance getting low", detail };
  return { key: "runpod", sev: "ok", title: "RunPod balance healthy", detail: `Runway back to ${days.toFixed(1)} days ($${balance.toFixed(2)}).` };
}

// ── check: disputes, and how close the rate is to losing card processing ───
async function checkDisputes(sql: any): Promise<Check | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  let all: any[];
  try {
    const r = await fetch("https://api.stripe.com/v1/disputes?limit=100", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await r.json();
    // No dispute_read scope, or Stripe hiccup — say nothing rather than cry wolf.
    if (j.error || !Array.isArray(j.data)) return null;
    all = j.data;
  } catch {
    return null;
  }

  const cutoff = Date.now() / 1000 - 30 * 86400;
  const recent = all.filter((d) => d.created >= cutoff);
  const open = all.filter((d) => DISPUTE_OPEN.has(d.status));

  const [p] = await sql`
    SELECT COUNT(*)::int AS n FROM transactions WHERE created_at >= now() - interval '30 days'`;
  const payments = Number(p?.n) || 0;
  const rate = payments ? (recent.length / payments) * 100 : 0;

  const lines: string[] = [];
  for (const d of open) {
    const due = d.evidence_details?.due_by
      ? new Date(d.evidence_details.due_by * 1000).toUTCString().slice(0, 16)
      : "no deadline given";
    lines.push(`• $${(d.amount / 100).toFixed(2)} — ${d.reason} — respond by ${due}`);
  }

  const detail =
    `**${open.length} open** · ${recent.length} in the last 30 days over ${payments} payments = **${rate.toFixed(2)}%**\n` +
    (lines.length ? `\n${lines.join("\n")}\n` : "") +
    `\nStripe reviews around ${DISPUTE_WARN_PCT}% and Visa's programme starts at ${DISPUTE_CRIT_PCT}%. ` +
    `An unanswered dispute is lost by default.`;

  if (open.length > 0 || rate >= DISPUTE_CRIT_PCT) {
    return { key: "disputes", sev: "crit", title: open.length ? "Dispute needs a response" : "Dispute rate past Visa's threshold", detail };
  }
  if (rate >= DISPUTE_WARN_PCT) {
    return { key: "disputes", sev: "warn", title: "Dispute rate approaching review", detail };
  }
  return { key: "disputes", sev: "ok", title: "Disputes back to normal", detail: `No open disputes; 30-day rate ${rate.toFixed(2)}%.` };
}

// ── check: has generation gone quiet when it normally would not? ───────────
async function checkFlatline(sql: any): Promise<Check | null> {
  const [row] = await sql`
    WITH recent AS (
      SELECT COUNT(*) AS n FROM usage_log
      WHERE created_at >= now() - (${FLATLINE_MIN} || ' minutes')::interval
        AND mode NOT LIKE '%refunded%'
    ),
    -- What this hour of the day normally does, over the last week.
    baseline AS (
      SELECT COUNT(*)::numeric / 7 AS per_hour FROM usage_log
      WHERE created_at >= now() - interval '7 days'
        AND EXTRACT(HOUR FROM created_at) = EXTRACT(HOUR FROM now())
        AND mode NOT LIKE '%refunded%'
    )
    SELECT recent.n AS recent, ROUND(baseline.per_hour, 1) AS expected FROM recent, baseline`;

  const recent = Number(row?.recent ?? 0);
  const expected = Number(row?.expected ?? 0);

  if (recent === 0 && expected >= FLATLINE_EXPECT) {
    return {
      key: "flatline", sev: "crit",
      title: "Generations have stopped",
      detail: `**0 generations in ${FLATLINE_MIN} minutes.** This hour normally runs about **${expected}**.\n\n` +
        "The API may still be answering 200 — this catches the case where it does but nothing completes: " +
        "GPU down, queue stuck, or the credit path failing.",
    };
  }
  return {
    key: "flatline", sev: "ok",
    title: "Generations flowing again",
    detail: `${recent} in the last ${FLATLINE_MIN} minutes (this hour normally ~${expected}).`,
  };
}

// ── run ────────────────────────────────────────────────────────────────────
const state = loadState();
const sql = getDb();
const now = Date.now();

if (TEST) {
  await post("warn", "Test alert", "Fired by `--test`. If you can read this, alerting works.");
  console.log("test alert sent");
  process.exit(0);
}

const checks: Check[] = [];

// Every run: the cheap probe that catches a broken handler.
checks.push(await checkApi(state));

// Throttled: the two that ask Postgres.
const lastDb = Number((state as any).__dbcheck?.notified ?? 0);
if (now - lastDb >= DB_CHECK_INTERVAL_MS) {
  for (const c of [await checkRunpod(sql), await checkDisputes(sql), await checkFlatline(sql)]) if (c) checks.push(c);
  (state as any).__dbcheck = { sev: "ok", since: now, notified: now };
} else {
  console.log(`(db checks throttled, ${Math.round((DB_CHECK_INTERVAL_MS - (now - lastDb)) / 1000)}s to go)`);
}

for (const c of checks) {
  const prev = state[c.key] ?? { sev: "ok" as Sev, since: now, notified: 0 };
  const changed = prev.sev !== c.sev;
  const stale = c.sev !== "ok" && now - (prev.notified || 0) > RENOTIFY_MS;

  // Recovery is only worth saying if we said something was wrong in the first place.
  const announce = (changed && (c.sev !== "ok" || prev.notified > 0)) || stale;

  if (announce) {
    await post(c.sev, c.title, c.detail);
    console.log(`${c.sev.toUpperCase().padEnd(4)} ${c.key}: ${c.title}${DRY ? " (dry)" : " — posted"}`);
  } else {
    console.log(`${c.sev.toUpperCase().padEnd(4)} ${c.key}: quiet`);
  }

  state[c.key] = {
    sev: c.sev,
    since: changed ? now : prev.since,
    notified: announce && c.sev !== "ok" ? now : (c.sev === "ok" ? 0 : prev.notified),
    strikes: state[c.key]?.strikes,
  };
}

if (!DRY) saveState(state);
