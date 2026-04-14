import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { DollarSign, Coins, Heart, TrendingUp, Loader2 } from "lucide-react";

interface EarningsSummary {
  totalCreditsEarned: number;
  creatorShareCredits: number;
  totalCentsEarned: number;
  creatorShareCents: number;
  charityCredits: number;
  charityCents: number;
  postUnlocks: number;
  storyUnlocks: number;
}

interface RecentTx {
  type: "post" | "story";
  creditsPaid: number;
  centsPaid: number;
  buyerName: string;
  unlockedAt: string;
}

interface EarningsData {
  summary: EarningsSummary;
  recent: RecentTx[];
}

const EarningsPanel: React.FC = () => {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const d = await apiFetch<EarningsData>("/earnings");
      setData(d);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || (data.summary.postUnlocks === 0 && data.summary.storyUnlocks === 0)) {
    return null; // Don't show panel if no earnings
  }

  const s = data.summary;
  const fmtCents = (c: number) => `$${(c / 100).toFixed(2)}`;
  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="bg-card/60 border border-border/40 rounded-lg p-4 space-y-4">
      <h2 className="font-orbitron text-xs text-muted-foreground tracking-widest flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5" /> CREATOR EARNINGS
      </h2>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Coins className="w-3 h-3 text-primary" />
            <span className="font-mono-share text-[9px] text-muted-foreground">CREDITS EARNED</span>
          </div>
          <div className="font-orbitron text-lg text-foreground">{s.creatorShareCredits}</div>
          <div className="font-mono-share text-[9px] text-muted-foreground">{s.postUnlocks + s.storyUnlocks} unlocks</div>
        </div>

        {s.totalCentsEarned > 0 && (
          <div className="bg-background/50 rounded-md p-3 border border-border/30">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="w-3 h-3 text-green-400" />
              <span className="font-mono-share text-[9px] text-muted-foreground">CASH EARNED</span>
            </div>
            <div className="font-orbitron text-lg text-green-400">{fmtCents(s.creatorShareCents)}</div>
            <div className="font-mono-share text-[9px] text-muted-foreground">75% of {fmtCents(s.totalCentsEarned)}</div>
          </div>
        )}

        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Heart className="w-3 h-3 text-pink-400" />
            <span className="font-mono-share text-[9px] text-muted-foreground">CHARITY DONATED</span>
          </div>
          <div className="font-orbitron text-sm text-pink-400">
            {s.charityCredits > 0 && `${s.charityCredits} cr`}
            {s.charityCredits > 0 && s.charityCents > 0 && " + "}
            {s.charityCents > 0 && fmtCents(s.charityCents)}
            {s.charityCredits === 0 && s.charityCents === 0 && "0"}
          </div>
          <div className="font-mono-share text-[9px] text-muted-foreground">5% to reforestation & orphans</div>
        </div>

        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-primary" />
            <span className="font-mono-share text-[9px] text-muted-foreground">BREAKDOWN</span>
          </div>
          <div className="font-mono-share text-[10px] text-foreground space-y-0.5">
            <div>{s.postUnlocks} post unlock{s.postUnlocks !== 1 ? "s" : ""}</div>
            <div>{s.storyUnlocks} story unlock{s.storyUnlocks !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      {data.recent.length > 0 && (
        <div>
          <h3 className="font-mono-share text-[9px] text-muted-foreground mb-2 tracking-widest">RECENT SALES</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {data.recent.map((tx, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] font-mono-share py-1 px-2 bg-background/30 rounded">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${tx.type === "post" ? "bg-primary/20 text-primary" : "bg-accent/20 text-accent-foreground"}`}>
                    {tx.type.toUpperCase()}
                  </span>
                  <span className="text-muted-foreground truncate">{tx.buyerName}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-foreground">
                    {tx.creditsPaid > 0 ? `${Math.floor(tx.creditsPaid * 0.75)} cr` : fmtCents(Math.floor(tx.centsPaid * 0.75))}
                  </span>
                  <span className="text-muted-foreground">{timeAgo(tx.unlockedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EarningsPanel;
