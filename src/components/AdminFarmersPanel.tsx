/**
 * Admin → Farmers panel.
 *
 * Lists users whose current credit balance far exceeds everything they ever
 * paid for. Real purchases (Stripe packs/subs, XRGE) always write a
 * transactions row with amount_cents > 0; free rewards (spins, missions,
 * daily refills, referral/follow/weekly bonuses) bump pack_credits directly.
 * So balance − purchased − admin-granted = credits obtained for free — a big
 * excess is the credit-farming signature.
 *
 * Each row expands into an evidence drilldown (action "farmer-detail"):
 * where the free credits came from (missions / one-time claims / referrals /
 * unlock income), the device-fingerprint cluster, and whether referees or
 * unlockers share the suspect's fingerprint (self-referral / alt-funded
 * unlock laundering). Rows can be banned in place.
 */

import { Fragment, useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import {
  Loader2, RefreshCw, Tractor, Ban, ShieldCheck, Star, ExternalLink,
  ChevronDown, ChevronRight, AlertTriangle,
} from "lucide-react";

interface Suspect {
  id: string;
  email: string;
  username: string | null;
  created_at: string;
  subscription_tier: string | null;
  is_creator: boolean;
  balance: number;
  purchased: number;
  admin_granted: number;
  paid_cents: number;
  lifetime_spent: number;
  fp_accounts: number;
  referrals: number;
  banned: boolean;
  excess: number;
}

interface FarmerDetail {
  user: {
    email: string; username: string | null; created_at: string; email_verified: boolean;
    subscription_tier: string | null; device_fingerprint: string | null;
    daily_credits: number; sub_credits: number; pack_credits: number;
    cash_balance_cents: number; last_free_spin: string | null; spin_streak: number; karma: number;
  };
  purchases: { credits: number; amount_cents: number; package: string; type: string; payment_method: string; created_at: string }[];
  missions: { credits: number; claims: number; days: number; first_day: string | null; last_day: string | null };
  oneTimeClaims: { claim_key: string; credits: number; created_at: string }[];
  referees: { created_at: string; referee_verified: boolean; referee_purchased: boolean; referrer_rewarded: boolean; email: string; username: string | null; same_fp: boolean }[];
  feedUnlockers: { user_id: string; email: string; username: string | null; unlocks: number; credits_paid: number; same_fp: boolean }[];
  storyUnlockers: { user_id: string; email: string; username: string | null; unlocks: number; credits_paid: number; same_fp: boolean }[];
  activity: { generations: number; spent: number; generations_7d: number; spent_7d: number; refunded: number; first_gen: string | null; last_gen: string | null };
  fpCluster: { id: string; email: string; username: string | null; created_at: string; balance: number; banned: boolean }[];
  referrer: { email: string; username: string | null; same_fp: boolean } | null;
}

const fmtAge = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "—");

const fmt$ = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const Flag: React.FC<{ label: string; severe?: boolean }> = ({ label, severe }) => (
  <span className={`inline-flex items-center gap-1 font-mono-share text-[9px] px-1.5 py-0.5 rounded border ${
    severe
      ? "border-destructive/50 text-destructive bg-destructive/10"
      : "border-amber-400/40 text-amber-300 bg-amber-400/10"
  }`}>
    <AlertTriangle className="w-2.5 h-2.5" />
    {label}
  </span>
);

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border border-border/30 rounded-lg bg-card/60 p-3 min-w-0">
    <div className="font-mono-share text-[9px] text-muted-foreground tracking-widest mb-2">{title}</div>
    {children}
  </div>
);

const UserLine: React.FC<{ email: string; username: string | null; same_fp?: boolean; suffix?: string }> = ({ email, username, same_fp, suffix }) => (
  <div className="flex items-center gap-1.5 font-mono-share text-[10px] truncate">
    {username ? (
      <a href={`/profile/${username}`} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary underline decoration-border/50 underline-offset-2 truncate">
        {username}
      </a>
    ) : (
      <span className="text-muted-foreground truncate">{email}</span>
    )}
    {username && <span className="text-muted-foreground/60 truncate">{email}</span>}
    {suffix && <span className="text-muted-foreground/70 shrink-0">{suffix}</span>}
    {same_fp && <Flag label="SAME DEVICE" severe />}
  </div>
);

function DetailView({ s, d }: { s: Suspect; d: FarmerDetail }) {
  const oneTimeTotal = d.oneTimeClaims.reduce((a, c) => a + (c.credits || 0), 0);
  const refRewarded = d.referees.filter((r) => r.referrer_rewarded).length;
  const refBonusEst = refRewarded * 10;
  const feedGross = d.feedUnlockers.reduce((a, u) => a + u.credits_paid, 0);
  const storyGross = d.storyUnlockers.reduce((a, u) => a + u.credits_paid, 0);
  const unlockIncome = Math.floor((feedGross + storyGross) * 0.75);
  const attributed = d.missions.credits + oneTimeTotal + refBonusEst + unlockIncome;
  const unattributed = Math.max(0, s.excess - attributed);

  const selfReferral = d.referees.some((r) => r.same_fp) || !!d.referrer?.same_fp;
  const altUnlocks = [...d.feedUnlockers, ...d.storyUnlockers].some((u) => u.same_fp);

  const flags: { label: string; severe: boolean }[] = [];
  if (s.purchased === 0 && s.paid_cents === 0) flags.push({ label: "NEVER PAID A CENT", severe: true });
  if (d.fpCluster.length >= 2) flags.push({ label: `${d.fpCluster.length + 1} ACCOUNTS ON DEVICE`, severe: d.fpCluster.length >= 3 });
  if (selfReferral) flags.push({ label: "SELF-REFERRAL (same device)", severe: true });
  if (altUnlocks) flags.push({ label: "ALT-FUNDED UNLOCKS (same device)", severe: true });
  if (s.lifetime_spent === 0 && s.balance > 500) flags.push({ label: "PURE HOARD (never spent)", severe: true });
  if (!d.user.email_verified) flags.push({ label: "EMAIL UNVERIFIED", severe: false });
  if (d.missions.days >= 30) flags.push({ label: `MISSION GRINDER (${d.missions.days} days) — may be legit`, severe: false });

  return (
    <div className="space-y-3 p-3 bg-background/40">
      {/* Signals */}
      <div className="flex flex-wrap gap-1.5">
        {flags.length > 0
          ? flags.map((f) => <Flag key={f.label} label={f.label} severe={f.severe} />)
          : <span className="font-mono-share text-[10px] text-muted-foreground">No automatic red flags — review sources below.</span>}
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {/* Where the excess came from */}
        <SectionCard title="EXCESS_ATTRIBUTION">
          <div className="font-mono-share text-[10px] space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Missions ({d.missions.claims} claims / {d.missions.days} days)</span><span className="text-foreground">{d.missions.credits.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">One-time bonuses ({d.oneTimeClaims.length})</span><span className="text-foreground">{oneTimeTotal.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Referral rewards ({refRewarded} × 10)</span><span className="text-foreground">{refBonusEst.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Unlock income (75% of {feedGross + storyGross})</span><span className="text-foreground">{unlockIncome.toLocaleString()}</span></div>
            <div className="flex justify-between border-t border-border/30 pt-1 mt-1">
              <span className="text-muted-foreground">Unattributed (spins, pot, drift)</span>
              <span className={unattributed > 500 ? "text-destructive font-bold" : "text-foreground"}>{unattributed.toLocaleString()}</span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground/70">of total excess</span><span className="text-secondary font-bold">{s.excess.toLocaleString()}</span></div>
          </div>
          <p className="font-mono-share text-[9px] text-muted-foreground/60 mt-2 leading-relaxed">
            Spins aren't logged per-event, so honest daily spinners show unattributed credits.
            Spin streak: {d.user.spin_streak} · last spin {d.user.last_free_spin ? fmtAge(d.user.last_free_spin) + " ago" : "never"}.
          </p>
        </SectionCard>

        {/* Activity */}
        <SectionCard title="ACTIVITY">
          <div className="font-mono-share text-[10px] space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Generations (lifetime)</span><span className="text-foreground">{d.activity.generations.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Credits spent (lifetime)</span><span className="text-foreground">{d.activity.spent.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Generations (7d)</span><span className="text-foreground">{d.activity.generations_7d.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Spent (7d)</span><span className="text-foreground">{d.activity.spent_7d.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Refunded jobs</span><span className="text-foreground">{d.activity.refunded.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">First / last gen</span><span className="text-foreground">{fmtDate(d.activity.first_gen)} → {fmtDate(d.activity.last_gen)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Karma</span><span className="text-foreground">{d.user.karma}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cash balance</span><span className="text-foreground">{fmt$(d.user.cash_balance_cents)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Balance split D/S/P</span><span className="text-foreground">{d.user.daily_credits}/{d.user.sub_credits}/{d.user.pack_credits}</span></div>
          </div>
        </SectionCard>

        {/* Purchases */}
        <SectionCard title={`PURCHASES (last ${d.purchases.length})`}>
          {d.purchases.length === 0 ? (
            <div className="font-mono-share text-[10px] text-destructive">No transactions ever.</div>
          ) : (
            <div className="font-mono-share text-[10px] space-y-1 max-h-40 overflow-y-auto">
              {d.purchases.map((t, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span className="text-muted-foreground truncate">{fmtDate(t.created_at)} {t.package} · {t.payment_method}</span>
                  <span className={`shrink-0 ${t.amount_cents > 0 ? "text-foreground" : "text-amber-300"}`}>
                    +{t.credits} {t.amount_cents > 0 ? fmt$(t.amount_cents) : "(free)"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Fingerprint cluster */}
        <SectionCard title={`DEVICE_CLUSTER (${d.fpCluster.length} other account${d.fpCluster.length === 1 ? "" : "s"})`}>
          {!d.user.device_fingerprint ? (
            <div className="font-mono-share text-[10px] text-amber-300">No fingerprint recorded — likely scripted signup.</div>
          ) : d.fpCluster.length === 0 ? (
            <div className="font-mono-share text-[10px] text-muted-foreground">No other accounts on this device.</div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {d.fpCluster.map((c) => (
                <UserLine key={c.id} email={c.email} username={c.username} suffix={`bal ${c.balance}${c.banned ? " · BANNED" : ""} · ${fmtAge(c.created_at)}`} />
              ))}
            </div>
          )}
        </SectionCard>

        {/* Referrals */}
        <SectionCard title={`REFERRALS (${d.referees.length} referred)`}>
          {d.referrer && (
            <div className="mb-2">
              <div className="font-mono-share text-[9px] text-muted-foreground/70 mb-0.5">REFERRED BY</div>
              <UserLine email={d.referrer.email} username={d.referrer.username} same_fp={d.referrer.same_fp} />
            </div>
          )}
          {d.referees.length === 0 ? (
            <div className="font-mono-share text-[10px] text-muted-foreground">Referred nobody.</div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {d.referees.map((r, i) => (
                <UserLine key={i} email={r.email} username={r.username} same_fp={r.same_fp}
                  suffix={`${r.referee_verified ? "✓verified" : "unverified"}${r.referee_purchased ? " · paid" : ""}${r.referrer_rewarded ? " · rewarded" : ""}`} />
              ))}
            </div>
          )}
        </SectionCard>

        {/* Unlock income */}
        <SectionCard title={`UNLOCK_INCOME (${feedGross + storyGross} cr gross)`}>
          {d.feedUnlockers.length === 0 && d.storyUnlockers.length === 0 ? (
            <div className="font-mono-share text-[10px] text-muted-foreground">Nobody unlocked their content.</div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {d.feedUnlockers.map((u) => (
                <UserLine key={`f-${u.user_id}`} email={u.email} username={u.username} same_fp={u.same_fp} suffix={`${u.unlocks} post unlock${u.unlocks === 1 ? "" : "s"} · ${u.credits_paid} cr`} />
              ))}
              {d.storyUnlockers.map((u) => (
                <UserLine key={`s-${u.user_id}`} email={u.email} username={u.username} same_fp={u.same_fp} suffix={`${u.unlocks} story unlock${u.unlocks === 1 ? "" : "s"} · ${u.credits_paid} cr`} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

const AdminFarmersPanel: React.FC = () => {
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [minExcess, setMinExcess] = useState(100);
  const [banningId, setBanningId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, FarmerDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch<{ suspects: Suspect[] }>("/admin", {
        method: "POST",
        body: { action: "credit-farmers", minExcess, limit: 200 },
      });
      setSuspects(res.suspects || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [minExcess]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDetail = async (s: Suspect) => {
    if (expandedId === s.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(s.id);
    if (!details[s.id]) {
      setDetailLoading(s.id);
      try {
        const res = await apiFetch<FarmerDetail>("/admin", {
          method: "POST",
          body: { action: "farmer-detail", userId: s.id },
        });
        setDetails((prev) => ({ ...prev, [s.id]: res }));
      } catch (e: any) {
        alert(e?.message || "Failed to load detail");
        setExpandedId(null);
      } finally {
        setDetailLoading(null);
      }
    }
  };

  const handleBan = async (s: Suspect) => {
    if (!confirm(`Permanently ban ${s.email}?\n\nBalance ${s.balance} vs bought ${s.purchased} (excess ${s.excess}).`)) return;
    setBanningId(s.id);
    try {
      await apiFetch("/admin", {
        method: "POST",
        body: { action: "ban-user", userId: s.id, reason: `Credit farming (balance ${s.balance}, purchased ${s.purchased}, excess ${s.excess})` },
      });
      setSuspects((prev) => prev.map((x) => (x.id === s.id ? { ...x, banned: true } : x)));
    } catch (e: any) {
      alert(e?.message || "Ban failed");
    } finally {
      setBanningId(null);
    }
  };

  const handleUnban = async (s: Suspect) => {
    setBanningId(s.id);
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "unban-user", userId: s.id } });
      setSuspects((prev) => prev.map((x) => (x.id === s.id ? { ...x, banned: false } : x)));
    } catch (e: any) {
      alert(e?.message || "Unban failed");
    } finally {
      setBanningId(null);
    }
  };

  const totalExcess = suspects.reduce((a, s) => a + (s.banned ? 0 : s.excess), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
          <Tractor className="w-3.5 h-3.5" />
          CREDIT_FARMERS
        </h2>
        <div className="flex items-center gap-2">
          <label className="font-mono-share text-[10px] text-muted-foreground flex items-center gap-1.5">
            MIN_EXCESS
            <input
              type="number"
              min={1}
              value={minExcess}
              onChange={(e) => setMinExcess(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-20 bg-card/60 border border-border/40 rounded px-2 py-1 font-mono-share text-[11px] text-foreground focus:border-primary/50 focus:outline-none"
            />
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="font-mono-share text-[10px] px-2 py-1 rounded border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 inline-flex items-center gap-1"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            REFRESH
          </button>
        </div>
      </div>

      <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-relaxed">
        EXCESS = current balance − credits ever purchased (Stripe/XRGE) − admin grants. Click a row
        for the evidence drilldown: where the free credits came from, other accounts on the same
        device, and whether their referrals or unlock "customers" are their own alts. Creators
        (★) can legitimately earn credits from unlocks — check before banning.
      </p>

      {err && (
        <div className="border border-destructive/40 bg-destructive/10 rounded p-3 font-mono-share text-[11px] text-destructive">
          {err}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-border/30 rounded-lg bg-card/40 p-3">
          <div className="font-mono-share text-[9px] text-muted-foreground tracking-widest">SUSPECTS</div>
          <div className="font-orbitron text-2xl text-primary mt-1">{loading ? "…" : suspects.length}</div>
          <div className="font-mono-share text-[10px] text-muted-foreground/70 mt-0.5">excess ≥ {minExcess} credits</div>
        </div>
        <div className="border border-border/30 rounded-lg bg-card/40 p-3">
          <div className="font-mono-share text-[9px] text-muted-foreground tracking-widest">UNPAID_CREDITS_HELD</div>
          <div className="font-orbitron text-2xl text-secondary mt-1">{loading ? "…" : totalExcess.toLocaleString()}</div>
          <div className="font-mono-share text-[10px] text-muted-foreground/70 mt-0.5">across unbanned suspects</div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border/30 rounded-lg bg-card/40 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border/30 font-mono-share text-[9px] text-muted-foreground tracking-widest">
              <th className="px-2 py-2 w-6"></th>
              <th className="px-3 py-2">USER</th>
              <th className="px-3 py-2 text-right">AGE</th>
              <th className="px-3 py-2 text-right">BALANCE</th>
              <th className="px-3 py-2 text-right">BOUGHT</th>
              <th className="px-3 py-2 text-right">GRANTED</th>
              <th className="px-3 py-2 text-right">PAID</th>
              <th className="px-3 py-2 text-right">SPENT</th>
              <th className="px-3 py-2 text-right">FP×</th>
              <th className="px-3 py-2 text-right">REFS</th>
              <th className="px-3 py-2 text-right">EXCESS</th>
              <th className="px-3 py-2 text-right">ACTION</th>
            </tr>
          </thead>
          <tbody>
            {suspects.map((s) => (
              <Fragment key={s.id}>
                <tr
                  onClick={() => toggleDetail(s)}
                  className={`border-b border-border/10 font-mono-share text-[11px] cursor-pointer hover:bg-card/60 ${s.banned ? "opacity-40" : ""} ${expandedId === s.id ? "bg-card/60" : ""}`}
                >
                  <td className="px-2 py-2 text-muted-foreground">
                    {expandedId === s.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </td>
                  <td className="px-3 py-2 max-w-[220px]">
                    <div className="flex items-center gap-1.5 truncate">
                      {s.is_creator && <Star className="w-3 h-3 text-amber-400 shrink-0" />}
                      {s.username ? (
                        <a
                          href={`/profile/${s.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-foreground truncate hover:text-primary underline decoration-border/50 underline-offset-2 inline-flex items-center gap-1"
                        >
                          {s.username}
                          <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground truncate">no profile</span>
                      )}
                      {s.subscription_tier && (
                        <span className="text-[9px] px-1 py-0.5 rounded border border-primary/30 text-primary/70 shrink-0">
                          {s.subscription_tier.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{s.email}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{fmtAge(s.created_at)}</td>
                  <td className="px-3 py-2 text-right text-foreground">{s.balance.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{s.purchased.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{s.admin_granted.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{fmt$(s.paid_cents)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{s.lifetime_spent.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right ${s.fp_accounts > 2 ? "text-destructive" : "text-muted-foreground"}`}>
                    {s.fp_accounts}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{s.referrals}</td>
                  <td className="px-3 py-2 text-right text-secondary font-bold">{s.excess.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {s.banned ? (
                      <button
                        onClick={() => handleUnban(s)}
                        disabled={banningId === s.id}
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border/40 text-muted-foreground hover:text-foreground"
                      >
                        {banningId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                        UNBAN
                      </button>
                    ) : (
                      <button
                        onClick={() => handleBan(s)}
                        disabled={banningId === s.id}
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        {banningId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                        BAN
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === s.id && (
                  <tr className="border-b border-border/20">
                    <td colSpan={12} className="p-0">
                      {detailLoading === s.id || !details[s.id] ? (
                        <div className="p-4 flex items-center gap-2 font-mono-share text-[10px] text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" /> Pulling evidence…
                        </div>
                      ) : (
                        <DetailView s={s} d={details[s.id]} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!loading && suspects.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center font-mono-share text-[11px] text-muted-foreground">
                  No users with excess ≥ {minExcess} credits.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminFarmersPanel;
