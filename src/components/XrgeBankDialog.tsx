import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  ShoppingCart,
  TrendingUp,
  Clock,
  AlertTriangle,
  Gift,
  Crown,
  Gem,
  Star,
  Award,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  XRGE_CHAIN_NAME,
  XRGE_CONTRACT,
  XRGE_DEXSCREENER_URL,
  basescanAddressUrl,
  basescanTxUrl,
} from "@/lib/xrgePublic";

interface BankData {
  bankBalance: number;
  lifetimeSpend: number;
  loyaltyTier: string;
  loyaltyTierName: string;
  bonusPercent: number;
  nextTier: {
    id: string;
    name: string;
    minSpend: number;
    bonusPercent: number;
    spendRemaining: number;
  } | null;
  allTiers: Array<{ id: string; name: string; minSpend: number; bonusPercent: number }>;
  depositAddress: string;
  xrgeUsdRate: number;
  walletAddress: string | null;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    txHash: string | null;
    metadata: any;
    createdAt: string;
  }>;
  pendingWithdrawals: Array<{
    id: string;
    amount: number;
    toAddress: string;
    status: string;
    createdAt: string;
  }>;
}

interface XrgeBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreditsRefresh?: () => void;
}

type Tab = "overview" | "deposit" | "buy" | "withdraw";

const TIER_ICONS: Record<string, React.ReactNode> = {
  bronze: <Award className="w-4 h-4" />,
  silver: <Star className="w-4 h-4" />,
  gold: <Crown className="w-4 h-4" />,
  diamond: <Gem className="w-4 h-4" />,
};

const TIER_COLORS: Record<string, string> = {
  bronze: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  silver: "text-slate-300 border-slate-400/30 bg-slate-400/10",
  gold: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  diamond: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10",
};

const PACKAGES = [
  { id: "starter", name: "STARTER", credits: 50, price: "$5" },
  { id: "pro", name: "PRO", credits: 175, price: "$15" },
  { id: "mega", name: "MEGA", credits: 450, price: "$35" },
  { id: "ultra", name: "ULTRA", credits: 2200, price: "$150" },
  { id: "enterprise", name: "ENTERPRISE", credits: 4500, price: "$300" },
];

const XrgeBankDialog: React.FC<XrgeBankDialogProps> = ({
  open,
  onOpenChange,
  onCreditsRefresh,
}) => {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<BankData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deposit state
  const [depositTxHash, setDepositTxHash] = useState("");
  const [depositing, setDepositing] = useState(false);
  const [depositResult, setDepositResult] = useState<{ deposited: number; newBalance: number } | null>(null);

  // Purchase state
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<{ totalCredits: number; xrgeSpent: number; bonusCredits: number } | null>(null);

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{ amount: number; status: string } | null>(null);

  // Flash sale state
  const [flashSale, setFlashSale] = useState<{ id: string; title: string; discount_percent: number; bonus_credits_percent: number; ends_at: string } | null>(null);

  // Copied state for address
  const [copied, setCopied] = useState(false);

  const fetchBalance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch("/v1/xrge-balance");
      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchBalance();
      setTab("overview");
      setDepositTxHash("");
      setDepositResult(null);
      setPurchaseResult(null);
      setWithdrawResult(null);
      setWithdrawAmount("");
      setWithdrawAddress("");
      // Fetch active flash sales
      apiFetch("/flash-sales").then(r => {
        if (r.sales && r.sales.length > 0) setFlashSale(r.sales[0]);
        else setFlashSale(null);
      }).catch(() => setFlashSale(null));
    }
  }, [open, fetchBalance]);

  const handleDeposit = async () => {
    if (!depositTxHash.trim()) return;
    setDepositing(true);
    setError(null);
    try {
      const result = await apiFetch("/v1/xrge-deposit", {
        method: "POST",
        body: { txHash: depositTxHash.trim() },
      });
      setDepositResult(result);
      setDepositTxHash("");
      await fetchBalance();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDepositing(false);
    }
  };

  const handlePurchase = async (packageId: string) => {
    setPurchasing(true);
    setError(null);
    try {
      const result = await apiFetch("/v1/xrge-purchase", {
        method: "POST",
        body: { package: packageId },
      });
      setPurchaseResult(result);
      onCreditsRefresh?.();
      await fetchBalance();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPurchasing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || !withdrawAddress) return;
    setWithdrawing(true);
    setError(null);
    try {
      const result = await apiFetch("/v1/xrge-withdraw", {
        method: "POST",
        body: { amount: parseFloat(withdrawAmount), toAddress: withdrawAddress.trim() },
      });
      setWithdrawResult(result);
      setWithdrawAmount("");
      setWithdrawAddress("");
      await fetchBalance();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setWithdrawing(false);
    }
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tierProgress = data && data.nextTier
    ? Math.min(100, ((data.lifetimeSpend) / data.nextTier.minSpend) * 100)
    : 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border border-pink-500/20 shadow-[0_0_48px_hsl(var(--primary)/0.08)] w-[min(96vw,40rem)] max-w-2xl max-h-[85vh] overflow-hidden p-0 gap-0 flex flex-col">
        <div className="credit-store-scroll scrollbar-cyber min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 [color-scheme:dark]">
          <DialogHeader>
            <DialogTitle className="font-orbitron text-sm tracking-wider flex items-center gap-2">
              <Wallet className="w-4 h-4 text-pink-400" />
              <span className="bg-gradient-to-r from-pink-400 to-violet-400 bg-clip-text text-transparent">
                XRGE_BANK
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* Tab bar */}
          <div className="flex gap-1 mt-4 bg-input/50 rounded-lg p-1 border border-border/30">
            {([
              { id: "overview" as Tab, label: "Overview", icon: <TrendingUp className="w-3 h-3" /> },
              { id: "deposit" as Tab, label: "Deposit", icon: <ArrowDownToLine className="w-3 h-3" /> },
              { id: "buy" as Tab, label: "Buy Credits", icon: <ShoppingCart className="w-3 h-3" /> },
              { id: "withdraw" as Tab, label: "Withdraw", icon: <ArrowUpFromLine className="w-3 h-3" /> },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setError(null); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[10px] font-orbitron tracking-wider transition-all ${
                  tab === t.id
                    ? "bg-pink-500/20 text-pink-300 border border-pink-500/30"
                    : "text-muted-foreground/60 hover:text-muted-foreground border border-transparent"
                }`}
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Error banner */}
          {error && (
            <div className="mt-3 flex items-start gap-2 border border-destructive/40 bg-destructive/10 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="font-mono-share text-xs text-destructive leading-relaxed flex-1">{error}</p>
              <button onClick={() => setError(null)} className="text-destructive/60 hover:text-destructive">✕</button>
            </div>
          )}

          {loading && !data ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-pink-400 animate-spin" />
            </div>
          ) : data ? (
            <>
              {/* ── OVERVIEW ── */}
              {tab === "overview" && (
                <div className="mt-4 space-y-4">
                  {/* Balance card */}
                  <div className="relative rounded-xl border border-pink-500/25 bg-gradient-to-br from-pink-950/30 to-violet-950/20 p-4 overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500/5 rounded-full -translate-y-12 translate-x-12" />
                    <p className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider">Bank Balance</p>
                    <p className="font-orbitron text-2xl font-black bg-gradient-to-r from-pink-300 to-violet-300 bg-clip-text text-transparent mt-1">
                      {data.bankBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm">XRGE</span>
                    </p>
                    <p className="font-mono-share text-[10px] text-muted-foreground/50 mt-1">
                      ≈ ${(data.bankBalance * data.xrgeUsdRate).toFixed(2)} USD
                    </p>
                  </div>

                  {/* Loyalty tier card */}
                  <div className={`rounded-lg border p-3 ${TIER_COLORS[data.loyaltyTier] || TIER_COLORS.bronze}`}>
                    <div className="flex items-center gap-2">
                      {TIER_ICONS[data.loyaltyTier] || TIER_ICONS.bronze}
                      <span className="font-orbitron text-xs tracking-wider font-bold">
                        {data.loyaltyTierName} TIER
                      </span>
                      <span className="ml-auto font-mono-share text-xs font-bold">
                        +{data.bonusPercent}% bonus
                      </span>
                    </div>

                    {data.nextTier && (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex justify-between font-mono-share text-[9px] text-current/60">
                          <span>Progress to {data.nextTier.name}</span>
                          <span>{data.nextTier.spendRemaining.toLocaleString()} XRGE to go</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-black/20 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-current/60 transition-all duration-700"
                            style={{ width: `${tierProgress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <p className="font-mono-share text-[9px] text-current/50 mt-2">
                      Lifetime: {data.lifetimeSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} XRGE spent
                    </p>
                  </div>

                  {/* All tiers */}
                  <div className="grid grid-cols-4 gap-2">
                    {data.allTiers.slice().reverse().map(tier => (
                      <div
                        key={tier.id}
                        className={`text-center rounded-lg border p-2.5 transition-all ${
                          tier.id === data.loyaltyTier
                            ? `${TIER_COLORS[tier.id]} ring-1 ring-current/30`
                            : "border-border/30 bg-card/30 opacity-50"
                        }`}
                      >
                        <div className="flex justify-center mb-1">
                          {TIER_ICONS[tier.id]}
                        </div>
                        <p className="font-orbitron text-[8px] tracking-wider font-bold">{tier.name}</p>
                        <p className="font-mono-share text-[10px] font-bold mt-0.5">+{tier.bonusPercent}%</p>
                        {tier.minSpend > 0 && (
                          <p className="font-mono-share text-[7px] text-muted-foreground/40 mt-0.5">
                            ≥{tier.minSpend >= 1_000_000_000 ? `${(tier.minSpend / 1_000_000_000).toFixed(0)}B` : tier.minSpend >= 1_000_000 ? `${(tier.minSpend / 1_000_000).toFixed(0)}M` : `${(tier.minSpend / 1000).toFixed(0)}K`}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Recent transactions */}
                  {data.transactions.length > 0 && (
                    <div className="space-y-2">
                      <p className="font-orbitron text-[10px] tracking-wider text-muted-foreground/60">RECENT_TRANSACTIONS</p>
                      <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-cyber">
                        {data.transactions.map(tx => (
                          <div key={tx.id} className="flex items-center gap-2 px-3 py-2 rounded border border-border/20 bg-card/20">
                            <span className={`font-orbitron text-[8px] tracking-wider px-1.5 py-0.5 rounded ${
                              tx.type === "deposit" ? "bg-green-500/10 text-green-400" :
                              tx.type === "purchase" ? "bg-pink-500/10 text-pink-400" :
                              tx.type === "withdrawal" ? "bg-orange-500/10 text-orange-400" :
                              "bg-blue-500/10 text-blue-400"
                            }`}>
                              {tx.type.toUpperCase()}
                            </span>
                            <span className={`font-mono-share text-xs font-bold ${
                              tx.type === "deposit" || tx.type === "refund" ? "text-green-400" : "text-pink-400"
                            }`}>
                              {tx.type === "deposit" || tx.type === "refund" ? "+" : "-"}
                              {tx.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>
                            <span className="ml-auto font-mono-share text-[9px] text-muted-foreground/40">
                              {new Date(tx.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                            {tx.txHash && (
                              <a
                                href={basescanTxUrl(tx.txHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground/30 hover:text-pink-400 transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── DEPOSIT ── */}
              {tab === "deposit" && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-4 space-y-3">
                    <p className="font-orbitron text-[10px] tracking-wider text-pink-300">
                      DEPOSIT XRGE TO YOUR BANK
                    </p>
                    <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-relaxed">
                      Send XRGE tokens to the deposit address below on {XRGE_CHAIN_NAME}, then paste your transaction hash to verify.
                    </p>

                    <div className="space-y-1.5">
                      <p className="font-mono-share text-[9px] text-muted-foreground/50">Deposit Address ({XRGE_CHAIN_NAME})</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-input/60 border border-border/30 rounded px-3 py-2 font-mono-share text-[10px] text-foreground/80 truncate select-all">
                          {data.depositAddress}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyAddress(data.depositAddress)}
                          className="shrink-0 gap-1 border-pink-500/30 hover:bg-pink-500/10"
                        >
                          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                      <a
                        href={basescanAddressUrl(data.depositAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono-share text-[9px] text-pink-400/60 hover:text-pink-400 transition-colors"
                      >
                        View on BaseScan <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>

                    <div className="space-y-1.5">
                      <p className="font-mono-share text-[9px] text-muted-foreground/50">XRGE Contract</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-input/60 border border-border/30 rounded px-3 py-2 font-mono-share text-[9px] text-foreground/60 truncate select-all">
                          {XRGE_CONTRACT}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyAddress(XRGE_CONTRACT)}
                          className="shrink-0 gap-1 border-border/30"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    <a
                      href={XRGE_DEXSCREENER_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono-share text-[10px] text-pink-400 hover:text-pink-300 underline underline-offset-2 transition-colors"
                    >
                      Get XRGE on DexScreener <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  {depositResult ? (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-center space-y-2">
                      <Gift className="w-6 h-6 text-green-400 mx-auto" />
                      <p className="font-orbitron text-xs text-green-400 tracking-wider">DEPOSIT CONFIRMED</p>
                      <p className="font-mono-share text-sm text-green-300 font-bold">
                        +{depositResult.deposited.toLocaleString(undefined, { maximumFractionDigits: 2 })} XRGE
                      </p>
                      <p className="font-mono-share text-[10px] text-muted-foreground/60">
                        New balance: {depositResult.newBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} XRGE
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDepositResult(null)}
                        className="font-mono-share text-[10px] mt-2"
                      >
                        MAKE ANOTHER DEPOSIT
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-mono-share text-[9px] text-muted-foreground/50">Transaction Hash</p>
                      <Input
                        value={depositTxHash}
                        onChange={e => setDepositTxHash(e.target.value)}
                        placeholder="0x..."
                        className="font-mono-share text-xs bg-input/50 border-border/30"
                      />
                      <Button
                        onClick={handleDeposit}
                        disabled={depositing || !depositTxHash.trim()}
                        className="w-full font-orbitron text-xs tracking-wider bg-pink-500/20 hover:bg-pink-500/30 text-pink-300 border border-pink-500/30"
                      >
                        {depositing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowDownToLine className="w-4 h-4 mr-2" />}
                        VERIFY DEPOSIT
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ── BUY CREDITS ── */}
              {tab === "buy" && (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="font-orbitron text-[10px] tracking-wider text-pink-300">BUY CREDITS FROM BANK</p>
                    <span className="font-mono-share text-[10px] text-muted-foreground/60">
                      Balance: {data.bankBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} XRGE
                    </span>
                  </div>

                  <div className={`flex items-center gap-2 px-3 py-2 rounded border ${TIER_COLORS[data.loyaltyTier] || TIER_COLORS.bronze}`}>
                    {TIER_ICONS[data.loyaltyTier]}
                    <span className="font-mono-share text-[10px]">
                      {data.loyaltyTierName} tier → <span className="font-bold">+{data.bonusPercent}% bonus credits</span> on every purchase
                    </span>
                  </div>

                  {purchaseResult ? (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-center space-y-2">
                      <Gift className="w-6 h-6 text-green-400 mx-auto" />
                      <p className="font-orbitron text-xs text-green-400 tracking-wider">PURCHASE COMPLETE</p>
                      <p className="font-mono-share text-sm text-green-300 font-bold">
                        +{purchaseResult.totalCredits} credits
                      </p>
                      {purchaseResult.bonusCredits > 0 && (
                        <p className="font-mono-share text-[10px] text-green-400/70">
                          Includes {purchaseResult.bonusCredits} bonus credits ({data.bonusPercent}% loyalty bonus)
                        </p>
                      )}
                      <p className="font-mono-share text-[10px] text-muted-foreground/60">
                        Spent: {purchaseResult.xrgeSpent.toLocaleString(undefined, { maximumFractionDigits: 2 })} XRGE
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPurchaseResult(null)}
                        className="font-mono-share text-[10px] mt-2"
                      >
                        BUY MORE
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {PACKAGES.map(pkg => {
                        const bonusCredits = Math.floor(pkg.credits * (data.bonusPercent / 100));
                        return (
                          <button
                            key={pkg.id}
                            onClick={() => handlePurchase(pkg.id)}
                            disabled={purchasing}
                            className="flex items-center gap-3 px-3 py-3 rounded-lg border border-border/30 bg-card/30 hover:border-pink-500/30 hover:bg-pink-500/5 transition-all group text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-orbitron text-[10px] tracking-wider text-foreground/80">{pkg.name}</span>
                                <span className="font-mono-share text-[9px] text-muted-foreground/40">{pkg.price}</span>
                              </div>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="font-mono-share text-xs text-foreground font-bold">{pkg.credits}</span>
                                {bonusCredits > 0 && (
                                  <span className="font-mono-share text-[10px] text-green-400 font-bold">+{bonusCredits}</span>
                                )}
                                <span className="font-mono-share text-[9px] text-muted-foreground/40">credits</span>
                              </div>
                            </div>
                            <div className="shrink-0 font-orbitron text-[9px] tracking-wider text-pink-400 group-hover:text-pink-300 transition-colors">
                              {purchasing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "BUY →"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── WITHDRAW ── */}
              {tab === "withdraw" && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4 space-y-2">
                    <p className="font-orbitron text-[10px] tracking-wider text-orange-300">
                      WITHDRAW XRGE
                    </p>
                    <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-relaxed">
                      Withdraw XRGE from your bank to any {XRGE_CHAIN_NAME} wallet. Minimum: 100 XRGE.
                      Withdrawals are processed within 24 hours.
                    </p>
                    <p className="font-mono-share text-[10px] text-muted-foreground/50">
                      Available: <span className="text-foreground font-bold">{data.bankBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> XRGE
                    </p>
                  </div>

                  {/* Pending withdrawals */}
                  {data.pendingWithdrawals.length > 0 && (
                    <div className="space-y-2">
                      <p className="font-orbitron text-[9px] tracking-wider text-orange-300/60">PENDING</p>
                      {data.pendingWithdrawals.map(w => (
                        <div key={w.id} className="flex items-center gap-2 px-3 py-2 rounded border border-orange-500/20 bg-orange-500/5">
                          <Clock className="w-3 h-3 text-orange-400 animate-pulse" />
                          <span className="font-mono-share text-xs text-orange-300 font-bold">
                            {w.amount.toLocaleString()} XRGE
                          </span>
                          <span className="font-mono-share text-[9px] text-muted-foreground/40 truncate">
                            → {w.toAddress.slice(0, 8)}...{w.toAddress.slice(-6)}
                          </span>
                          <span className="ml-auto font-orbitron text-[7px] tracking-wider text-orange-400/60 uppercase">
                            {w.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {withdrawResult ? (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-center space-y-2">
                      <ArrowUpFromLine className="w-6 h-6 text-green-400 mx-auto" />
                      <p className="font-orbitron text-xs text-green-400 tracking-wider">WITHDRAWAL QUEUED</p>
                      <p className="font-mono-share text-sm text-green-300 font-bold">
                        {withdrawResult.amount.toLocaleString()} XRGE
                      </p>
                      <p className="font-mono-share text-[10px] text-muted-foreground/60">
                        Will be processed within 24 hours.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWithdrawResult(null)}
                        className="font-mono-share text-[10px] mt-2"
                      >
                        OK
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <p className="font-mono-share text-[9px] text-muted-foreground/50">Amount (XRGE)</p>
                        <Input
                          type="number"
                          value={withdrawAmount}
                          onChange={e => setWithdrawAmount(e.target.value)}
                          placeholder="100"
                          min={100}
                          className="font-mono-share text-xs bg-input/50 border-border/30"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <p className="font-mono-share text-[9px] text-muted-foreground/50">Destination Address ({XRGE_CHAIN_NAME})</p>
                        <Input
                          value={withdrawAddress}
                          onChange={e => setWithdrawAddress(e.target.value)}
                          placeholder="0x..."
                          className="font-mono-share text-xs bg-input/50 border-border/30"
                        />
                      </div>
                      <Button
                        onClick={handleWithdraw}
                        disabled={withdrawing || !withdrawAmount || !withdrawAddress || parseFloat(withdrawAmount) < 100}
                        className="w-full font-orbitron text-xs tracking-wider bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30"
                      >
                        {withdrawing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowUpFromLine className="w-4 h-4 mr-2" />}
                        REQUEST WITHDRAWAL
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}

          {/* Rate info footer */}
          {data && (
            <div className="border-t border-border/20 pt-3 mt-4">
              <p className="font-mono-share text-[9px] text-muted-foreground/40 leading-relaxed">
                XRGE rate: ${data.xrgeUsdRate.toFixed(6)}/token · {XRGE_CHAIN_NAME} network ·{" "}
                <a href={XRGE_DEXSCREENER_URL} target="_blank" rel="noopener noreferrer" className="text-pink-400/60 hover:text-pink-400 underline">
                  DexScreener
                </a>
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default XrgeBankDialog;
