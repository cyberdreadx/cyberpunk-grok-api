/**
 * Admin → Farmers panel.
 *
 * Lists users whose current credit balance far exceeds everything they ever
 * paid for. Real purchases (Stripe packs/subs, XRGE) always write a
 * transactions row with amount_cents > 0; free rewards (spins, missions,
 * daily refills, referral/follow/weekly bonuses) bump pack_credits directly.
 * So balance − purchased − admin-granted = credits obtained for free — a big
 * excess is the credit-farming signature. Rows can be banned in place.
 */

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Loader2, RefreshCw, Tractor, Ban, ShieldCheck, Star, ExternalLink } from "lucide-react";

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

const fmtAge = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
};

const fmt$ = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const AdminFarmersPanel: React.FC = () => {
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [minExcess, setMinExcess] = useState(100);
  const [banningId, setBanningId] = useState<string | null>(null);

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
        EXCESS = current balance − credits ever purchased (Stripe/XRGE) − admin grants. Free rewards
        (spins, missions, daily, referrals) leave no purchase record, so a huge excess means the
        credits were farmed, not bought. FP× = accounts sharing this device fingerprint. Creators
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
              <tr key={s.id} className={`border-b border-border/10 font-mono-share text-[11px] ${s.banned ? "opacity-40" : ""}`}>
                <td className="px-3 py-2 max-w-[220px]">
                  <div className="flex items-center gap-1.5 truncate">
                    {s.is_creator && <Star className="w-3 h-3 text-amber-400 shrink-0" />}
                    {s.username ? (
                      <a
                        href={`/profile/${s.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
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
                <td className="px-3 py-2 text-right">
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
            ))}
            {!loading && suspects.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center font-mono-share text-[11px] text-muted-foreground">
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
