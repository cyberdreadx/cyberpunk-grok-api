/**
 * Community Credit Pot dialog — shows global pool, allows claim + donate,
 * shows top donors. Mounted as a modal from the More menu.
 */
import React, { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Heart, Coins, X, Trophy, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface PotData {
  balance: number;
  totalDonated: number;
  totalClaimed: number;
  dailyRation: number;
  claim: { amount: number; claimedToday: boolean; eligible: boolean; reason: string | null };
  topDonors: Array<{ username: string; total: number }>;
  todayDonors: Array<{ username: string; total: number }>;
  userBalance: { sub: number; pack: number };
}

const DONATE_PRESETS = [10, 50, 100, 500];

export const CommunityPotDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [data, setData] = useState<PotData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [tab, setTab] = useState<"today" | "alltime">("today");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<PotData>("/community-pot");
      setData(d);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load pot");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!open) return null;

  const claim = async () => {
    setBusy(true);
    try {
      const r = await apiFetch<{ granted: number }>("/community-pot", {
        method: "POST", body: { action: "claim" },
      });
      toast.success(`+${r.granted} credits from the pot 🎉`);
      await refresh();
      window.dispatchEvent(new CustomEvent("credits:refresh"));
    } catch (e: any) {
      toast.error(e?.message || "Claim failed");
    } finally {
      setBusy(false);
    }
  };

  const donate = async (amount: number) => {
    if (!Number.isFinite(amount) || amount < 1) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ donated: number }>("/community-pot", {
        method: "POST", body: { action: "donate", amount },
      });
      toast.success(`Donated ${r.donated} credits — thank you 💜`);
      setCustomAmount("");
      await refresh();
      window.dispatchEvent(new CustomEvent("credits:refresh"));
    } catch (e: any) {
      toast.error(e?.message || "Donation failed");
    } finally {
      setBusy(false);
    }
  };

  const totalUserCredits = (data?.userBalance.sub || 0) + (data?.userBalance.pack || 0);
  const fillPct = data ? Math.min(100, Math.max(2, (data.balance / Math.max(100, data.dailyRation * 50)) * 100)) : 0;
  const donors = data ? (tab === "today" ? data.todayDonors : data.topDonors) : [];

  return (
    <div
      className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-card border border-primary/30 sm:rounded-lg shadow-glow-ambient max-h-[90dvh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-2 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-5 pt-5 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-fuchsia-400" />
            <h2 className="font-orbitron text-sm tracking-[0.2em] text-primary">COMMUNITY POT</h2>
          </div>
          <p className="font-mono-share text-[10px] text-muted-foreground/70 mt-1">
            Shared credits anyone verified can claim once per day. Donate to keep it alive.
          </p>
        </div>

        <div className="p-5 space-y-5">
          {loading && !data && (
            <div className="text-center py-12 text-xs text-muted-foreground">Loading pot…</div>
          )}

          {data && (
            <>
              {/* Pot bar */}
              <div className="space-y-2">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="font-orbitron text-3xl text-foreground tabular-nums">
                      {data.balance.toLocaleString()}
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                      credits in pot
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono-share text-[10px] text-cyan-300">
                      +{data.totalDonated.toLocaleString()} donated
                    </div>
                    <div className="font-mono-share text-[10px] text-fuchsia-300">
                      −{data.totalClaimed.toLocaleString()} claimed
                    </div>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted/30 overflow-hidden border border-border/60">
                  <div
                    className="h-full bg-gradient-to-r from-fuchsia-400 via-primary to-cyan-400 transition-all duration-500"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
              </div>

              {/* Claim */}
              <div className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-orbitron text-xs tracking-wider text-primary">
                    DAILY CLAIM · {data.dailyRation} credits
                  </div>
                  <Sparkles className="w-3.5 h-3.5 text-primary/70" />
                </div>
                <button
                  onClick={claim}
                  disabled={busy || !data.claim.eligible}
                  className="w-full py-2.5 rounded bg-primary/15 border border-primary/50 text-primary font-orbitron text-xs tracking-wider hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {data.claim.claimedToday
                    ? "CLAIMED TODAY ✓"
                    : data.claim.eligible
                      ? `CLAIM +${data.claim.amount} CREDITS`
                      : "UNAVAILABLE"}
                </button>
                {data.claim.reason && (
                  <p className="text-[10px] text-muted-foreground/70 text-center">{data.claim.reason}</p>
                )}
              </div>

              {/* Donate */}
              <div className="rounded-md border border-fuchsia-400/30 bg-fuchsia-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-orbitron text-xs tracking-wider text-fuchsia-300">
                    DONATE TO POT
                  </div>
                  <span className="font-mono-share text-[10px] text-muted-foreground/70">
                    your balance: {totalUserCredits.toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {DONATE_PRESETS.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => donate(amt)}
                      disabled={busy || totalUserCredits < amt}
                      className="py-2 rounded border border-fuchsia-400/40 text-fuchsia-200 font-orbitron text-[11px] hover:bg-fuchsia-500/15 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      +{amt}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="custom amount"
                    className="flex-1 bg-muted/20 border border-border/60 rounded px-3 py-2 text-sm focus:outline-none focus:border-fuchsia-400/60"
                  />
                  <button
                    onClick={() => donate(parseInt(customAmount, 10))}
                    disabled={busy || !customAmount || totalUserCredits < parseInt(customAmount, 10)}
                    className="px-3 rounded bg-fuchsia-500/20 border border-fuchsia-400/50 text-fuchsia-200 font-orbitron text-[11px] hover:bg-fuchsia-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    GIVE
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground/60">
                  Pulled from your pack credits first, then sub credits. Non-refundable.
                </p>
              </div>

              {/* Donors leaderboard */}
              <div className="rounded-md border border-border/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-orbitron text-xs tracking-wider text-foreground">PATRONS</span>
                  </div>
                  <div className="flex gap-1 text-[10px]">
                    {(["today", "alltime"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-2 py-1 rounded font-mono-share uppercase tracking-wider transition ${
                          tab === t
                            ? "bg-primary/15 text-primary border border-primary/40"
                            : "text-muted-foreground/60 border border-transparent hover:text-foreground"
                        }`}
                      >
                        {t === "alltime" ? "all-time" : "24h"}
                      </button>
                    ))}
                  </div>
                </div>
                {donors.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/60 text-center py-4">
                    No donations yet. Be the first patron 💜
                  </p>
                ) : (
                  <ol className="space-y-1.5">
                    {donors.map((d, i) => (
                      <li
                        key={`${d.username}-${i}`}
                        className="flex items-center justify-between text-[12px] font-mono-share"
                      >
                        <span className="flex items-center gap-2">
                          <span className={`w-5 text-center ${i === 0 ? "text-amber-400" : i === 1 ? "text-zinc-300" : i === 2 ? "text-orange-400" : "text-muted-foreground/50"}`}>
                            {i + 1}
                          </span>
                          <span className="text-foreground/90">@{d.username}</span>
                        </span>
                        <span className="flex items-center gap-1 text-cyan-300">
                          <Coins className="w-3 h-3" />
                          {d.total.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommunityPotDialog;
