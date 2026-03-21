import React, { useState, useEffect, useRef } from "react";
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
  CheckCircle2,
  ExternalLink,
  Zap,
  Clock,
  AlertTriangle,
  Gift,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  XRGE_CHAIN_NAME,
  XRGE_CHAIN_ID,
  XRGE_CONTRACT,
  XRGE_DEXSCREENER_URL,
  basescanAddressUrl,
} from "@/lib/xrgePublic";

interface XrgeOrder {
  orderId: string;
  xrgeAmount: string;
  depositAddress: string;
  expiresAt: string;
  baseCredits: number;
  bonusCredits: number;
  totalCredits: number;
  packageName: string;
  bonusPercent: number;
}

interface XrgePaymentDialogProps {
  open: boolean;
  onClose: () => void;
  packageId: string | null;
  onSuccess: () => void;
}

type Step = "loading" | "pay" | "verifying" | "success" | "error";

const XrgePaymentDialog: React.FC<XrgePaymentDialogProps> = ({
  open,
  onClose,
  packageId,
  onSuccess,
}) => {
  const [step, setStep] = useState<Step>("loading");
  const [order, setOrder] = useState<XrgeOrder | null>(null);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"address" | "amount" | "all" | null>(null);
  const [timeLeft, setTimeLeft] = useState("");
  const [creditsAdded, setCreditsAdded] = useState(0);
  const [bonusAdded, setBonusAdded] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // Create order when dialog opens
  useEffect(() => {
    if (!open || !packageId) return;
    setStep("loading");
    setTxHash("");
    setError("");
    setOrder(null);

    (async () => {
      try {
        const data = await apiFetch<XrgeOrder>("/xrge-checkout", {
          method: "POST",
          body: { package: packageId },
        });
        setOrder(data);
        setStep("pay");
      } catch (err: any) {
        setError(err.message || "Failed to create order");
        setStep("error");
      }
    })();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open, packageId]);

  // Countdown timer
  useEffect(() => {
    if (!order?.expiresAt || step !== "pay") return;
    const update = () => {
      const diff = new Date(order.expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("EXPIRED");
        setError("Order expired. Close and try again.");
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${m}:${s.toString().padStart(2, "0")}`);
    };
    update();
    timerRef.current = setInterval(update, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [order?.expiresAt, step]);

  const copyToClipboard = async (text: string, type: "address" | "amount" | "all") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2500);
    } catch {}
  };

  const copyPaymentBlock = () => {
    if (!order) return;
    const text = [
      `XRGE pack payment — ${XRGE_CHAIN_NAME} (chain ${XRGE_CHAIN_ID})`,
      `Send exactly: ${order.xrgeAmount} XRGE (ERC-20)`,
      `To wallet: ${order.depositAddress}`,
      `Token contract (XRGE): ${XRGE_CONTRACT}`,
      `Do not send ETH or other tokens — XRGE on Base only.`,
    ].join("\n");
    copyToClipboard(text, "all");
  };

  const handleVerify = async () => {
    if (!order || !txHash.trim()) return;
    setStep("verifying");
    setError("");

    try {
      const data = await apiFetch("/xrge-verify", {
        method: "POST",
        body: { orderId: order.orderId, txHash: txHash.trim() },
      });
      setCreditsAdded(data.credits);
      setBonusAdded(data.bonusCredits || order.bonusCredits);
      setStep("success");
    } catch (err: any) {
      setError(err.message || "Verification failed");
      setStep("pay"); // go back to payment step so they can retry
    }
  };

  const handleClose = () => {
    if (step === "success") onSuccess();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md border-primary/30 bg-background/95 backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle className="font-orbitron text-sm tracking-widest text-primary flex items-center gap-2">
            <span className="text-secondary">$XRGE</span> PAYMENT
          </DialogTitle>
        </DialogHeader>

        {/* Loading */}
        {step === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="font-mono-share text-xs text-muted-foreground">
              Creating order...
            </p>
          </div>
        )}

        {/* Error (no order) */}
        {step === "error" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <AlertTriangle className="w-8 h-8 text-destructive" />
            <p className="font-mono-share text-xs text-destructive text-center">
              {error}
            </p>
            <Button
              onClick={handleClose}
              variant="outline"
              className="font-orbitron text-[10px] tracking-wider"
            >
              CLOSE
            </Button>
          </div>
        )}

        {/* Payment step */}
        {(step === "pay" || step === "verifying") && order && (
          <div className="space-y-4">
            <ol className="list-decimal list-inside space-y-1 rounded border border-border/40 bg-card/40 px-3 py-2 font-mono-share text-[9px] text-muted-foreground leading-relaxed">
              <li>
                Get XRGE on {XRGE_CHAIN_NAME} if needed —{" "}
                <a
                  href={XRGE_DEXSCREENER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  DexScreener
                </a>{" "}
                · bridge ETH on{" "}
                <a href="https://bridge.base.org" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                  bridge.base.org
                </a>
              </li>
              <li>Copy amount + address below (or use “Copy all”). Send XRGE only.</li>
              <li>After it confirms, paste the transaction hash and verify.</li>
            </ol>

            {/* Package info with bonus */}
            <div className="border border-secondary/30 rounded-lg p-3 bg-secondary/5">
              <div className="flex items-center justify-between mb-1">
                <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">
                  {order.packageName} PACK
                </span>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                  <span
                    className={`font-mono-share text-[10px] ${
                      timeLeft === "EXPIRED" ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {timeLeft}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-secondary" />
                <span className="font-mono-share text-lg font-bold text-secondary">
                  {order.totalCredits.toLocaleString()} credits
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <Gift className="w-3 h-3 text-green-400" />
                <span className="font-mono-share text-[10px] text-green-400">
                  Includes {order.bonusCredits} bonus credits ({order.bonusPercent}% XRGE bonus!)
                </span>
              </div>
            </div>

            {/* Send amount */}
            <div>
              <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                SEND_EXACTLY
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 border border-primary/40 rounded bg-card/60 px-3 py-2 font-mono-share text-sm text-primary font-bold select-all">
                  {order.xrgeAmount} XRGE
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(order.xrgeAmount, "amount")}
                  className="border-primary/30 px-2"
                >
                  {copied === "amount" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Deposit address */}
            <div>
              <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                TO_ADDRESS ({XRGE_CHAIN_NAME} · chain {XRGE_CHAIN_ID})
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 border border-primary/40 rounded bg-card/60 px-3 py-2 font-mono-share text-[11px] text-foreground/80 break-all select-all">
                  {order.depositAddress}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(order.depositAddress, "address")}
                  className="border-primary/30 px-2"
                >
                  {copied === "address" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <a
                  href={basescanAddressUrl(order.depositAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono-share text-[8px] text-primary/70 hover:text-primary"
                >
                  View on Basescan
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={copyPaymentBlock}
              className="w-full font-mono-share text-[10px] gap-2 border border-pink-500/30 bg-pink-500/10 hover:bg-pink-500/20"
            >
              {copied === "all" ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  COPIED_FULL_PAYMENT_DETAILS
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  COPY_ALL_FOR_WALLET / TELEGRAM
                </>
              )}
            </Button>

            {/* Warning */}
            <div className="flex items-start gap-2 border border-yellow-600/30 rounded p-2 bg-yellow-600/5">
              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
              <p className="font-mono-share text-[9px] text-yellow-500/80 leading-relaxed">
                Send <span className="font-bold text-yellow-500">XRGE tokens on Base chain only</span>.
                Sending any other token or using the wrong chain will result in permanent loss.
              </p>
            </div>

            {/* Transaction hash input */}
            <div>
              <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                TRANSACTION_HASH
              </label>
              <Input
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x..."
                className="font-mono-share text-xs"
                disabled={step === "verifying"}
              />
              <p className="font-mono-share text-[8px] text-muted-foreground/50 mt-1">
                After sending, paste the transaction hash here
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 border border-destructive/30 rounded p-2 bg-destructive/5">
                <AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                <p className="font-mono-share text-[10px] text-destructive">{error}</p>
              </div>
            )}

            {/* Verify button */}
            <Button
              onClick={handleVerify}
              disabled={
                !txHash.trim() ||
                step === "verifying" ||
                timeLeft === "EXPIRED"
              }
              className="w-full font-orbitron text-[10px] tracking-wider bg-secondary text-secondary-foreground hover:bg-secondary/80 gap-2"
            >
              {step === "verifying" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  VERIFYING ON-CHAIN...
                </>
              ) : (
                "VERIFY_PAYMENT"
              )}
            </Button>

            {/* Basescan link */}
            {txHash.trim() && /^0x[a-fA-F0-9]{64}$/.test(txHash.trim()) && (
              <a
                href={`https://basescan.org/tx/${txHash.trim()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 font-mono-share text-[9px] text-primary/60 hover:text-primary transition-colors"
              >
                View on Basescan
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="relative">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
              <div className="absolute inset-0 w-12 h-12 rounded-full bg-green-400/20 animate-ping" />
            </div>
            <div className="text-center">
              <p className="font-orbitron text-sm tracking-wider text-foreground mb-1">
                PAYMENT_VERIFIED
              </p>
              <div className="flex items-center justify-center gap-1 mb-2">
                <Zap className="w-4 h-4 text-secondary" />
                <span className="font-mono-share text-xl font-bold text-secondary">
                  +{creditsAdded.toLocaleString()} credits
                </span>
              </div>
              {bonusAdded > 0 && (
                <div className="flex items-center justify-center gap-1">
                  <Gift className="w-3 h-3 text-green-400" />
                  <span className="font-mono-share text-[10px] text-green-400">
                    Including {bonusAdded} bonus credits!
                  </span>
                </div>
              )}
            </div>
            <Button
              onClick={handleClose}
              className="font-orbitron text-[10px] tracking-wider bg-primary text-primary-foreground hover:bg-primary/80"
            >
              CLOSE
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default XrgePaymentDialog;
