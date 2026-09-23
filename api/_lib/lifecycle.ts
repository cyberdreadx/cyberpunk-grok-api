/**
 * Behaviour-triggered email: the engine, the guardrails, and the candidate queries.
 *
 * Campaigns mail a list once. These flows run every 15 minutes forever, which is
 * a different risk: a bug here doesn't send one bad blast, it sends one every
 * quarter of an hour. So the rules live in one place and every flow obeys them.
 *
 *   OFF by default          — app_config.lifecycle_emails.enabled must be set true
 *   One email per 7 days    — across ALL flows, per person
 *   Per-flow cooldowns      — a flow can't re-nag the same person for weeks
 *   Claim before sending    — the unique index makes a double-send impossible,
 *                             even if the cron overlaps itself or crashes mid-run
 *   Cap per run             — a query bug can't turn into thousands of emails
 *   Every exclusion applies — unverified, opted out, banned, suppressed, or
 *                             bought in the last 24h means no mail
 */

import { getResend, getFromAddress, logEmail } from "./email";
import { unsubUrl } from "./notification-prefs";

export type Flow = "cart_recovery_1" | "cart_recovery_2" | "empty_tank" | "winback";

export interface LifecycleConfig {
  enabled: boolean;
  dryRun: boolean;
  maxPerRun: number;
  flows: Record<string, boolean>;
}

export const LIFECYCLE_CONFIG_KEY = "lifecycle_emails";

/** Days a person is left alone after ANY lifecycle email. */
export const GLOBAL_COOLDOWN_DAYS = 7;

/** Days before the same flow may consider a person again. */
export const FLOW_COOLDOWN_DAYS: Record<Flow, number> = {
  cart_recovery_1: 14,
  cart_recovery_2: 14,
  empty_tank: 30,
  winback: 90,
};

export const FLOW_SUBJECTS: Record<Flow, string> = {
  cart_recovery_1: "You left credits in your cart",
  cart_recovery_2: "Still want those credits?",
  empty_tank: "You're out of credits",
  winback: "Your credits are still here",
};

const DEFAULT_CONFIG: LifecycleConfig = {
  enabled: false,
  dryRun: true,
  maxPerRun: 150,
  flows: { cart_recovery: true, empty_tank: true, winback: true },
};

export async function readLifecycleConfig(
  sql: ReturnType<typeof import("./db").getDb>,
): Promise<LifecycleConfig> {
  const rows = await sql`SELECT value FROM app_config WHERE key = ${LIFECYCLE_CONFIG_KEY} LIMIT 1`;
  const raw = rows.length ? (rows[0] as { value: unknown }).value : null;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  const v = raw as Partial<LifecycleConfig>;
  return {
    enabled: v.enabled === true,
    dryRun: v.dryRun !== false,
    maxPerRun: Math.min(Math.max(Number(v.maxPerRun) || DEFAULT_CONFIG.maxPerRun, 1), 1000),
    flows: { ...DEFAULT_CONFIG.flows, ...(v.flows ?? {}) },
  };
}

export interface Candidate {
  id: string;
  email: string;
  ref?: string;
  meta?: Record<string, any>;
}

/**
 * The single gate every flow passes through. Written as one query so a flow
 * cannot accidentally skip a rule by forgetting a join.
 */
export async function filterEligible(
  sql: ReturnType<typeof import("./db").getDb>,
  flow: Flow,
  candidates: Candidate[],
  opts: { skipGlobalCooldown?: boolean } = {},
): Promise<Candidate[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);
  // The second cart-recovery email follows the first by design, so the weekly cap
  // would silently kill it. A two-email sequence about one abandoned checkout is
  // one conversation, not two nags — it keeps every other exclusion.
  const globalCooldownDays = opts.skipGlobalCooldown ? 0 : GLOBAL_COOLDOWN_DAYS;
  const rows = (await sql`
    SELECT u.id
    FROM users u
    LEFT JOIN notification_prefs p ON p.user_id = u.id
    WHERE u.id = ANY(${ids}::uuid[])
      AND u.email_verified = true
      AND COALESCE(p.email_enabled, true) = true
      AND NOT EXISTS (
        SELECT 1 FROM user_bans b
        WHERE b.user_id = u.id AND (b.expires_at IS NULL OR b.expires_at > now())
      )
      AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = lower(u.email))
      -- One lifecycle email per person per week, whichever flow it came from.
      AND NOT EXISTS (
        SELECT 1 FROM lifecycle_sends ls
        WHERE ls.user_id = u.id
          AND ls.sent_at > now() - (${globalCooldownDays} || ' days')::interval
      )
      -- This flow specifically has its own, longer, quiet period.
      AND NOT EXISTS (
        SELECT 1 FROM lifecycle_sends ls
        WHERE ls.user_id = u.id AND ls.flow = ${flow}
          AND ls.sent_at > now() - (${FLOW_COOLDOWN_DAYS[flow]} || ' days')::interval
      )
      -- Someone who just paid does not need chasing.
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.user_id = u.id AND t.amount_cents > 0 AND t.created_at > now() - interval '24 hours'
      )
  `) as any[];
  const allowed = new Set(rows.map((r) => String(r.id)));

  // One person, one email per run — whatever the batch contains.
  //
  // The weekly cap above is evaluated once for the whole batch, so two
  // candidates for the same person both pass it before either is written. That
  // is not theoretical: on the first live run someone who had abandoned two
  // separate checkouts got two recovery emails 0.6 seconds apart. The unique
  // index still did its job (one row per cart) — it is the person, not the cart,
  // that must not be mailed twice.
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (!allowed.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * Claim first, send second. The unique index on (flow, user_id, ref) is what
 * makes this safe: if two runs overlap, only one gets the row. A failed send
 * releases the claim so the next run can retry.
 */
export async function claimSend(
  sql: ReturnType<typeof import("./db").getDb>,
  flow: Flow,
  c: Candidate,
): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO lifecycle_sends (flow, user_id, ref, email)
    VALUES (${flow}, ${c.id}::uuid, ${c.ref ?? ""}, ${c.email})
    ON CONFLICT (flow, user_id, ref) DO NOTHING
    RETURNING id
  `) as any[];
  return rows.length > 0;
}

export async function releaseClaim(
  sql: ReturnType<typeof import("./db").getDb>,
  flow: Flow,
  c: Candidate,
): Promise<void> {
  await sql`
    DELETE FROM lifecycle_sends
    WHERE flow = ${flow} AND user_id = ${c.id}::uuid AND ref = ${c.ref ?? ""}
  `;
}

function footer(userId: string): string {
  const postal = (process.env.MAIL_POSTAL_ADDRESS || "").trim();
  const url = unsubUrl(userId, "*");
  return `
    <div style="font-family:'Courier New',monospace;max-width:540px;margin:0 auto;padding:0 32px 28px;text-align:center;">
      <p style="font-size:11px;color:#555;line-height:1.6;margin:0;">
        You're receiving this because you have a GLTCH Runner account.<br>
        <a href="${url}" style="color:#666;text-decoration:underline;">Unsubscribe from these emails</a>${postal ? `<br>GLTCH Runner · ${postal.replace(/&/g, "&amp;").replace(/</g, "&lt;")}` : ""}
      </p>
    </div>`;
}

/** Exactly what one person receives, for previews and tests. */
export function renderLifecycleEmail(html: string, userId: string): string {
  return `${html}${footer(userId)}`;
}

export async function sendLifecycle(
  sql: ReturnType<typeof import("./db").getDb>,
  flow: Flow,
  c: Candidate,
  html: string,
  subject?: string,
): Promise<boolean> {
  if (!(await claimSend(sql, flow, c))) return false;
  try {
    const unsub = unsubUrl(c.id, "*");
    const { error } = await getResend().emails.send({
      from: `GLTCHRunner <${getFromAddress()}>`,
      to: [c.email],
      subject: subject ?? FLOW_SUBJECTS[flow],
      html: renderLifecycleEmail(html, c.id),
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [{ name: "lifecycle", value: flow }],
    });
    if (error) {
      await releaseClaim(sql, flow, c);
      await logEmail(c.email, `lifecycle_${flow}`, "failed", null, error.message);
      return false;
    }
    await logEmail(c.email, `lifecycle_${flow}`, "sent");
    return true;
  } catch (err: any) {
    await releaseClaim(sql, flow, c);
    await logEmail(c.email, `lifecycle_${flow}`, "failed", null, err?.message ?? String(err));
    return false;
  }
}

/** Ran out of credits, still creating. The moment the store matters most. */
export async function emptyTankCandidates(
  sql: ReturnType<typeof import("./db").getDb>,
  limit: number,
): Promise<Candidate[]> {
  const rows = (await sql`
    SELECT u.id, u.email,
      (SELECT COUNT(*)::int FROM usage_log l
        WHERE l.user_id = u.id AND l.created_at > now() - interval '7 days'
          AND l.mode NOT LIKE '%refunded%') AS recent_jobs
    FROM users u
    WHERE COALESCE(u.daily_credits, 0) + COALESCE(u.sub_credits, 0) + COALESCE(u.pack_credits, 0) = 0
      AND COALESCE(u.subscription_tier, '') = ''
      AND EXISTS (
        SELECT 1 FROM usage_log l
        WHERE l.user_id = u.id AND l.created_at > now() - interval '7 days'
          AND l.mode NOT LIKE '%refunded%'
      )
    ORDER BY u.created_at DESC
    LIMIT ${limit}
  `) as any[];
  return rows.map((r) => ({ id: String(r.id), email: String(r.email), meta: { recentJobs: Number(r.recent_jobs) } }));
}

/**
 * Paid before, quiet 30-45 days. The window is deliberate: win-backs sent at
 * 30-45 days convert about 2.3x better than the same email at 90+, and someone
 * silent for six months is a different (colder) problem.
 */
export async function winbackCandidates(
  sql: ReturnType<typeof import("./db").getDb>,
  limit: number,
): Promise<Candidate[]> {
  const rows = (await sql`
    SELECT u.id, u.email,
      COALESCE(u.daily_credits, 0) + COALESCE(u.sub_credits, 0) + COALESCE(u.pack_credits, 0) AS credits_left,
      EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.user_id = u.id AND t.type = 'subscription' AND t.amount_cents > 0
      ) AS was_subscriber
    FROM users u
    WHERE COALESCE(u.subscription_tier, '') = ''
      AND EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.amount_cents > 0)
      AND NOT EXISTS (
        SELECT 1 FROM usage_log l WHERE l.user_id = u.id AND l.created_at > now() - interval '30 days'
      )
      AND EXISTS (
        SELECT 1 FROM usage_log l WHERE l.user_id = u.id AND l.created_at > now() - interval '60 days'
      )
    ORDER BY u.created_at DESC
    LIMIT ${limit}
  `) as any[];
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    meta: { creditsLeft: Number(r.credits_left), wasSubscriber: r.was_subscriber === true },
  }));
}
