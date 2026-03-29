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
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  ShoppingCart,
  Trophy,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Zap,
  Clock,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  XRGE_CHAIN_NAME,
  XRGE_CONTRACT,
  XRGE_DEXSCREENER_URL,
  basescanAddressUrl,
} from "@/lib/xrgePublic";

interface BankData {
  balance: string;
  lifetimeSpend: string;
  walletAddress: string | null;
  depositAddress: string | null;
  loyalty: {
    tier: string;
    name: string;
    bonusPercent: number;
    nextTier: {
      tier: string;
      name: string;
      bonusPercent: number;
      xrgeNeeded: string;
    } | null;
  };
  tiers: { id: string; name: string; minSpend: number; bonusPercent: number }[];
  recentTransactions: {
    type: string;
    amount: string;
    balanceAfter: string;
    txHash: string | null;
    package: string | null;
    creditsAwarded: number | null;
    bonusCredits: number | null;
    loyaltyTier: string | null;
    note: string | null;
    createdAt: string;
  }[];
}

interface XrgeBankDialogProps {
  open: boolean;
  onClose: () => void;
  onCreditsRefresh?: () => void;
  /** Fetch balance via the user's session (frontend API) */
  apiKeyHeader?: string;
}

type Tab = "overview" | "deposit" | "purchase" | "withdraw" | "history";

const TIER_COLORS: Record<string, string> = {
  bronze: "text-amber-600",
  silver: "text-slate-300",
  gold: "text-yellow-400",
  diamond: "text-cyan-300",
};

const TIER_BG: Record<string, string> = {
  bronze: "from-amber-900/20 to-amber-700/10 border-amber-600/30",
  silver: "from-slate-700/20 to-slate-500/10 border-slate-400/30",
  gold: "from-yellow-900/20 to-yellow-600/10 border-yellow-500/30",
  diamond: "from-cyan-900/20 to-cyan-500/10 border-cyan-400/30",
};

const PACKAGES = [
  { id: "starter", name: "STARTER", credits: 50, price: "$5" },
  { id: "pro", name: "PRO", credits: 175, price: "$15" },
  { id: "mega", name: "MEGA", credits: 450, price: "$35" },
  { id: "ultra", name: "ULTRA", credits: 1800, price: "$150" },
  { id: "enterprise", name: "ENTERPRISE", credits: 4000, price: "$300" },
];

const XrgeBankDialog: React.FC<XrgeBankDialogProps> = ({
  open,
  onClose,
  onCreditsRefresh,
}) => {
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [bank, setBank] = useState<BankData | null>(null);
  const [error, setError] = useState("");

  // Deposit state
  const [depositTxHash, setDepositTxHash] = useState("");
  const [depositing, setDepositing] = useState(false);
  const [depositResult, setDepositResult] = useState<any>(null);

  // Purchase state
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<any>(null);

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<any>(null);

  const [copied, setCopied] = useState(false);

  const fetchBalance = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<BankData>("/v1/xrge-balance");
      setBank(data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to load XRGE bank");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchBalance();
      setTab("overview");
      setDepositResult(null);
      setPurchaseResult(null);
      setWithdrawResult(null);
    }
  }, [open, fetchBalance]);

  const handleDeposit = async () => {
    if (!depositTxHash.trim()) return;
    setDepositing(true);
    setError("");
    setDepositResult(null);
    try {
      const data = await apiFetch("/v1/xrge-deposit", {
        method: "POST",
        body: { txHash: depositTxHash.trim() },
      });
      setDepositResult(data);
      setDepositTxHash("");
      await fetchBalance();
    } catch (err: any) {
      setError(err.message || "Deposit failed");
    } finally {
      setDepositing(false);
    }
  };

  const handlePurchase = async (packageId: string) => {
    setPurchasing(true);
    setError("");
    setPurchaseResult(null);
    try {
      const data = await apiFetch("/v1/xrge-purchase", {
        method: "POST",
        body: { package: packageId },
      });
      setPurchaseResult(data);
      onCreditsRefresh?.();
      await fetchBalance();
    } catch (err: any) {
      setError(err.message || "Purchase failed");
    } finally {
      setPurchasing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount.trim()) return;
    setWithdrawing(true);
    setError("");
    setWithdrawResult(null);
    try {
      const data = await apiFetch("/v1/xrge-withdraw", {
        method: "POST",
        body: {
          amount: withdrawAmount.trim(),
          ...(withdrawAddress.trim() ? { toAddress: withdrawAddress.trim() } : {}),
        },
      });
      setWithdrawResult(data);
      setWithdrawAmount("");
      setWithdrawAddress("");
      await fetchBalance();
    } catch (err: any) {
      setError(err.message || "Withdrawal failed");
    } finally {
      setWithdrawing(false);
    }
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const bal = parseFloat(bank?.balance || "0");
  const tier = bank?.loyalty?.tier || "bronze";
  const tierName = bank?.loyalty?.name || "Bronze";
  const bonusPct = bank?.loyalty?.bonusPercent || 30;

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: "overview", icon: <Wallet className="w-3 h-3" />, label: "BANK" },
    { id: "deposit", icon: <ArrowDownToLine className="w-3 h-3" />, label: "DEPOSIT" },
    { id: "purchase", icon: <ShoppingCart className="w-3 h-3" />, label: "BUY" },
    { id: "withdraw", icon: <ArrowUpFromLine className="w-3 h-3" />, label: "WITHDRAW" },
    { id: "history", icon: <Clock className="w-3 h-3" />, label: "HISTORY" },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg border-primary/30 bg-background/95 backdrop-blur-sm max-h-[85vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="font-orbitron text-sm tracking-widest text-primary flex items-center gap-2">
            <img src="/xrge-logo.png" alt="" className="h-5 w-5 rounded-full" />
            <span className="text-pink-400">$XRGE</span> BANK
          </DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b border-border/30 px-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(""); }}
              className={`flex items-center gap-1.5 px-3 py-2.5 font-orbitron text-[8px] tracking-wider transition-all border-b-2 ${
                tab === t.id
                  ? "border-pink-400 text-pink-400"
                  : "border-transparent text-muted-foreground hover:text-foreground/80"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-cyber">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="w-8 h-8 animate-spin text-pink-400" />
              <p className="font-mono-share text-xs text-muted-foreground">Loading XRGE bank...</p>
            </div>
          ) : (
            <>
              {/* Error banner */}
              {error && (
                <div className="flex items-start gap-2 border border-destructive/30 rounded p-2 bg-destructive/5">
                  <AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                  <p className="font-mono-share text-[10px] text-destructive">{error}</p>
                </div>
              )}

              {/* ── OVERVIEW ── */}
              {tab === "overview" && bank && (
                <>
                  {/* Balance card */}
                  <div className={`rounded-lg border bg-gradient-to-br p-4 ${TIER_BG[tier] || TIER_BG.bronze}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-orbitron text-[9px] tracking-widest text-muted-foreground">
                        BANK_BALANCE
                      </span>
                      <div className="flex items-center gap-1">
                        <Trophy className={`w-3 h-3 ${TIER_COLORS[tier] || "text-amber-600"}`} />
                        <span className={`font-orbitron text-[9px] tracking-wider ${TIER_COLORS[tier] || "text-amber-600"}`}>
                          {tierName.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono-share text-3xl font-bold text-foreground">
                        {bal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                      <span className="font-mono-share text-sm text-pink-400">XRGE</span>
                    </div>
                    {bank.walletAddress && (
                      <p className="mt-2 font-mono-share text-[9px] text-muted-foreground/60 truncate">
                        Wallet: {bank.walletAddress}
                      </p>
                    )}
                  </div>

                  {/* Loyalty tier info */}
                  <div className="border border-border/30 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Trophy className={`w-4 h-4 ${TIER_COLORS[tier]}`} />
                      <span className="font-orbitron text-[10px] tracking-wider text-foreground">
                        LOYALTY_TIER: {tierName.toUpperCase()}
                      </span>
                      <span className="ml-auto font-mono-share text-[10px] text-green-400 font-bold">
                        +{bonusPct}% bonus
                      </span>
                    </div>
                    <p className="font-mono-share text-[9px] text-muted-foreground/70">
                      Lifetime XRGE spent: {parseFloat(bank.lifetimeSpend).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>

                    {bank.loyalty.nextTier && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono-share text-[8px] text-muted-foreground/60">
                            Next: {bank.loyalty.nextTier.name} (+{bank.loyalty.nextTier.bonusPercent}%)
                          </span>
                          <span className="font-mono-share text-[8px] text-muted-foreground/60">
                            {parseFloat(bank.loyalty.nextTier.xrgeNeeded).toLocaleString(undefined, { maximumFractionDigits: 0 })} XRGE to go
                          </span>
                        </div>
                        <ProgressBar current={bank} />
                      </div>
                    )}
                  </div>

                  {/* All tiers */}
                  <div className="grid grid-cols-4 gap-2">
                    {(bank.tiers || []).slice().reverse().map((t) => (
                      <div
                        key={t.id}
                        className={`rounded border p-2 text-center transition-all ${
                          t.id === tier
                            ? `${TIER_BG[t.id] || ""} ring-1 ring-offset-1 ring-offset-background ${t.id === "diamond" ? "ring-cyan-400/50" : t.id === "gold" ? "ring-yellow-400/50" : t.id === "silver" ? "ring-slate-400/50" : "ring-amber-500/50"}`
                            : "border-border/20 bg-card/30 opacity-60"
                        }`}
                      >
                        <Trophy className={`w-3 h-3 mx-auto mb-1 ${TIER_COLORS[t.id] || "text-muted-foreground"}`} />
                        <p className={`font-orbitron text-[7px] tracking-wider ${TIER_COLORS[t.id] || "text-muted-foreground"}`}>
                          {t.name.toUpperCase()}
                        </p>
                        <p className="font-mono-share text-[9px] text-green-400 font-bold mt-0.5">
                          +{t.bonusPercent}%
                        </p>
                        <p className="font-mono-share text-[7px] text-muted-foreground/50 mt-0.5">
                          {t.minSpend > 0 ? `${(t.minSpend / 1000).toFixed(0)}K` : "Start"}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Quick actions */}
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setTab("deposit")}
                      className="font-orbitron text-[8px] tracking-wider gap-1 border-green-500/30 hover:bg-green-500/10 text-green-400"
                    >
                      <ArrowDownToLine className="w-3 h-3" />
                      DEPOSIT
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setTab("purchase")}
                      className="font-orbitron text-[8px] tracking-wider gap-1 border-pink-500/30 hover:bg-pink-500/10 text-pink-400"
                    >
                      <ShoppingCart className="w-3 h-3" />
                      BUY_CREDITS
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setTab("withdraw")}
                      className="font-orbitron text-[8px] tracking-wider gap-1 border-primary/30 hover:bg-primary/10"
                    >
                      <ArrowUpFromLine className="w-3 h-3" />
                      WITHDRAW
                    </Button>
                  </div>
                </>
              )}

              {/* ── DEPOSIT ── */}
              {tab === "deposit" && bank && (
                <>
                  <div className="space-y-3">
                    <p className="font-mono-share text-[10px] text-muted-foreground/80 leading-relaxed">
                      Send XRGE tokens on <span className="text-pink-400 font-bold">{XRGE_CHAIN_NAME}</span> to our deposit
                      address. Any amount is accepted. After the transaction confirms (~30 sec), paste the tx hash below.
                    </p>

                    <div>
                      <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                        DEPOSIT_ADDRESS ({XRGE_CHAIN_NAME})
                      </label>
                      <DepositAddressDisplay depositAddress={bank.depositAddress} onCopy={copyAddress} copied={copied} />
                    </div>

                    <div>
                      <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                        TRANSACTION_HASH
                      </label>
                      <Input
                        value={depositTxHash}
                        onChange={(e) => setDepositTxHash(e.target.value)}
                        placeholder="0x..."
                        className="font-mono-share text-xs"
                        disabled={depositing}
                      />
                    </div>

                    <Button
                      onClick={handleDeposit}
                      disabled={!depositTxHash.trim() || depositing}
                      className="w-full font-orbitron text-[10px] tracking-wider bg-green-600 text-white hover:bg-green-500 gap-2"
                    >
                      {depositing ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> VERIFYING...</>
                      ) : (
                        <><ArrowDownToLine className="w-3 h-3" /> VERIFY_DEPOSIT</>
                      )}
                    </Button>

                    {depositResult && (
                      <div className="flex items-center gap-2 border border-green-500/30 rounded p-3 bg-green-500/5">
                        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                        <div>
                          <p className="font-orbitron text-[10px] text-green-400 tracking-wider">
                            DEPOSIT_CONFIRMED
                          </p>
                          <p className="font-mono-share text-xs text-foreground mt-0.5">
                            +{depositResult.deposited} XRGE added to bank
                          </p>
                          <p className="font-mono-share text-[9px] text-muted-foreground/60">
                            New balance: {depositResult.balance} XRGE
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <a
                    href={XRGE_DEXSCREENER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 font-mono-share text-[9px] text-pink-400/70 hover:text-pink-400"
                  >
                    Need XRGE? Buy on DexScreener <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}

              {/* ── PURCHASE ── */}
              {tab === "purchase" && bank && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-orbitron text-[9px] tracking-widest text-muted-foreground">
                      BUY_CREDITS_FROM_BANK
                    </span>
                    <span className="font-mono-share text-xs text-pink-400">
                      Balance: {bal.toFixed(2)} XRGE
                    </span>
                  </div>

                  <div className={`rounded border p-2 bg-gradient-to-r ${TIER_BG[tier]}`}>
                    <div className="flex items-center gap-1.5">
                      <Trophy className={`w-3 h-3 ${TIER_COLORS[tier]}`} />
                      <span className={`font-orbitron text-[9px] tracking-wider ${TIER_COLORS[tier]}`}>
                        {tierName} TIER
                      </span>
                      <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                      <span className="font-mono-share text-[10px] text-green-400 font-bold">
                        +{bonusPct}% bonus on all purchases
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {PACKAGES.map((pkg) => {
                      const bonus = Math.floor(pkg.credits * (bonusPct / 100));
                      const total = pkg.credits + bonus;
                      return (
                        <div
                          key={pkg.id}
                          className="flex items-center gap-3 border border-border/30 rounded-lg p-3 hover:border-pink-500/30 transition-all"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-orbitron text-[10px] tracking-wider text-foreground">
                                {pkg.name}
                              </span>
                              <span className="font-mono-share text-[9px] text-muted-foreground">
                                {pkg.price}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Zap className="w-3 h-3 text-secondary" />
                              <span className="font-mono-share text-sm font-bold text-secondary">
                                {total}
                              </span>
                              <span className="font-mono-share text-[9px] text-muted-foreground">
                                credits
                              </span>
                              <span className="font-mono-share text-[8px] text-green-400 bg-green-400/10 px-1 py-0.5 rounded-full ml-1">
                                +{bonus} bonus
                              </span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handlePurchase(pkg.id)}
                            disabled={purchasing}
                            className="font-orbitron text-[8px] tracking-wider bg-pink-600 hover:bg-pink-500 text-white shrink-0"
                          >
                            {purchasing ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              "BUY"
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  {purchaseResult && (
                    <div className="flex items-center gap-2 border border-green-500/30 rounded p-3 bg-green-500/5">
                      <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                      <div>
                        <p className="font-orbitron text-[10px] text-green-400 tracking-wider">
                          PURCHASE_COMPLETE
                        </p>
                        <p className="font-mono-share text-xs text-foreground mt-0.5">
                          +{purchaseResult.totalCredits} credits ({purchaseResult.baseCredits} + {purchaseResult.bonusCredits} bonus)
                        </p>
                        <p className="font-mono-share text-[9px] text-muted-foreground/60">
                          Spent {purchaseResult.xrgeSpent} XRGE · Remaining: {purchaseResult.balance} XRGE
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── WITHDRAW ── */}
              {tab === "withdraw" && bank && (
                <>
                  <p className="font-mono-share text-[10px] text-muted-foreground/80 leading-relaxed">
                    Withdraw XRGE from your bank back to your wallet on {XRGE_CHAIN_NAME}.
                    Minimum withdrawal: 100 XRGE. Processed within ~10 minutes.
                  </p>

                  <div className="flex items-center justify-between">
                    <span className="font-orbitron text-[9px] tracking-widest text-muted-foreground">
                      AVAILABLE
                    </span>
                    <span className="font-mono-share text-sm text-pink-400 font-bold">
                      {bal.toFixed(4)} XRGE
                    </span>
                  </div>

                  <div>
                    <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                      AMOUNT
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder="100.0000"
                        className="font-mono-share text-xs"
                        disabled={withdrawing}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWithdrawAmount(bank.balance)}
                        className="font-mono-share text-[8px] shrink-0"
                      >
                        MAX
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                      TO_ADDRESS {bank.walletAddress ? "(optional — defaults to saved wallet)" : "(required)"}
                    </label>
                    <Input
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      placeholder={bank.walletAddress || "0x..."}
                      className="font-mono-share text-xs"
                      disabled={withdrawing}
                    />
                    {bank.walletAddress && !withdrawAddress && (
                      <p className="font-mono-share text-[8px] text-muted-foreground/50 mt-1">
                        Will send to: {bank.walletAddress}
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={handleWithdraw}
                    disabled={!withdrawAmount.trim() || withdrawing}
                    className="w-full font-orbitron text-[10px] tracking-wider bg-primary text-primary-foreground hover:bg-primary/80 gap-2"
                  >
                    {withdrawing ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> PROCESSING...</>
                    ) : (
                      <><ArrowUpFromLine className="w-3 h-3" /> REQUEST_WITHDRAWAL</>
                    )}
                  </Button>

                  {withdrawResult && (
                    <div className="flex items-center gap-2 border border-primary/30 rounded p-3 bg-primary/5">
                      <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                      <div>
                        <p className="font-orbitron text-[10px] text-primary tracking-wider">
                          WITHDRAWAL_QUEUED
                        </p>
                        <p className="font-mono-share text-xs text-foreground mt-0.5">
                          {withdrawResult.amount} XRGE → {withdrawResult.toAddress.slice(0, 10)}...
                        </p>
                        <p className="font-mono-share text-[9px] text-muted-foreground/60">
                          {withdrawResult.estimatedProcessing}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── HISTORY ── */}
              {tab === "history" && bank && (
                <>
                  <span className="font-orbitron text-[9px] tracking-widest text-muted-foreground">
                    RECENT_TRANSACTIONS
                  </span>
                  {(bank.recentTransactions || []).length === 0 ? (
                    <p className="font-mono-share text-xs text-muted-foreground/50 text-center py-8">
                      No transactions yet. Deposit XRGE to get started.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {bank.recentTransactions.map((tx, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 border border-border/20 rounded p-2.5 bg-card/30"
                        >
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                            tx.type === "deposit" ? "bg-green-500/10" :
                            tx.type === "purchase" ? "bg-pink-500/10" :
                            tx.type === "withdraw" ? "bg-primary/10" :
                            "bg-blue-500/10"
                          }`}>
                            {tx.type === "deposit" ? <ArrowDownToLine className="w-3 h-3 text-green-400" /> :
                             tx.type === "purchase" ? <ShoppingCart className="w-3 h-3 text-pink-400" /> :
                             tx.type === "withdraw" ? <ArrowUpFromLine className="w-3 h-3 text-primary" /> :
                             <Zap className="w-3 h-3 text-blue-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-orbitron text-[9px] tracking-wider text-foreground uppercase">
                                {tx.type}
                              </span>
                              {tx.creditsAwarded && (
                                <span className="font-mono-share text-[8px] text-secondary">
                                  +{tx.creditsAwarded} cr
                                </span>
                              )}
                            </div>
                            <p className="font-mono-share text-[8px] text-muted-foreground/50 truncate">
                              {tx.note || (tx.txHash ? `tx: ${tx.txHash.slice(0, 16)}...` : "")}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`font-mono-share text-xs font-bold ${
                              parseFloat(tx.amount) >= 0 ? "text-green-400" : "text-red-400"
                            }`}>
                              {parseFloat(tx.amount) >= 0 ? "+" : ""}{parseFloat(tx.amount).toFixed(2)}
                            </p>
                            <p className="font-mono-share text-[8px] text-muted-foreground/40">
                              {new Date(tx.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

function DepositAddressDisplay({ depositAddress, onCopy, copied }: {
  depositAddress: string | null;
  onCopy: (addr: string) => void;
  copied: boolean;
}) {
  if (!depositAddress) {
    return (
      <div className="border border-border/30 rounded bg-card/60 px-3 py-2">
        <p className="font-mono-share text-[9px] text-muted-foreground">
          Deposit address not available. Contact support.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 border border-primary/40 rounded bg-card/60 px-3 py-2 font-mono-share text-[11px] text-foreground/80 break-all select-all">
        {depositAddress}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onCopy(depositAddress)}
        className="border-primary/30 px-2"
      >
        {copied ? (
          <CheckCircle2 className="w-4 h-4 text-green-400" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </Button>
    </div>
  );
}

function ProgressBar({ current }: { current: BankData }) {
  const tier = current.loyalty;
  if (!tier.nextTier) return null;

  const nextTierData = current.tiers.find((t) => t.id === tier.nextTier!.tier);
  const currentTierData = current.tiers.find((t) => t.id === tier.tier);
  if (!nextTierData || !currentTierData) return null;

  const spent = parseFloat(current.lifetimeSpend);
  const range = nextTierData.minSpend - currentTierData.minSpend;
  const progress = range > 0 ? Math.min(((spent - currentTierData.minSpend) / range) * 100, 100) : 0;

  return (
    <div className="w-full h-1.5 rounded-full bg-border/30 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-pink-500 to-cyan-400 transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export default XrgeBankDialog;
