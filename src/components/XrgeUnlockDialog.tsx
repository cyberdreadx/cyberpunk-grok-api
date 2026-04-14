import React, { useState } from "react";
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
  AlertTriangle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  XRGE_CHAIN_NAME,
  XRGE_CHAIN_ID,
  XRGE_CONTRACT,
  XRGE_DEXSCREENER_URL,
  basescanAddressUrl,
} from "@/lib/xrgePublic";

interface XrgeUnlockDialogProps {
  open: boolean;
  onClose: () => void;
  xrgeAmount: string;
  postId?: string;
  storyId?: string;
  onSuccess: () => void;
}

const XrgeUnlockDialog: React.FC<XrgeUnlockDialogProps> = ({
  open,
  onClose,
  xrgeAmount,
  postId,
  storyId,
  onSuccess,
}) => {
  const [txHash, setTxHash] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState<"address" | "amount" | "all" | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);

  // Fetch deposit address on open
  React.useEffect(() => {
    if (!open) {
      setTxHash("");
      setError("");
      setSuccess(false);
      setDepositAddress(null);
      return;
    }
    (async () => {
      try {
        const data = await apiFetch<{ depositAddress: string }>("/v1/xrge-balance");
        setDepositAddress(data.depositAddress);
      } catch {
        setError("Failed to load deposit address");
      }
    })();
  }, [open]);

  const copyToClipboard = async (text: string, type: "address" | "amount" | "all") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2500);
    } catch {}
  };

  const copyPaymentBlock = () => {
    if (!depositAddress) return;
    const text = [
      `XRGE unlock payment — ${XRGE_CHAIN_NAME} (chain ${XRGE_CHAIN_ID})`,
      `Send exactly: ${xrgeAmount} XRGE (ERC-20)`,
      `To wallet: ${depositAddress}`,
      `Token contract (XRGE): ${XRGE_CONTRACT}`,
      `Do not send ETH or other tokens — XRGE on Base only.`,
    ].join("\n");
    copyToClipboard(text, "all");
  };

  const handleVerify = async () => {
    if (!txHash.trim()) return;
    setVerifying(true);
    setError("");
    try {
      await apiFetch("/xrge-unlock", {
        method: "POST",
        body: { txHash: txHash.trim(), postId, storyId },
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleClose = () => {
    if (success) onSuccess();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md border-primary/30 bg-background/95 backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle className="font-orbitron text-sm tracking-widest text-primary flex items-center gap-2">
            <span className="text-secondary">$XRGE</span> UNLOCK
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="relative">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
              <div className="absolute inset-0 w-12 h-12 rounded-full bg-green-400/20 animate-ping" />
            </div>
            <p className="font-orbitron text-sm tracking-wider text-foreground">UNLOCKED!</p>
            <p className="font-mono-share text-xs text-muted-foreground text-center">
              Content unlocked. 80% sent to creator, 20% platform fee.
            </p>
            <Button onClick={handleClose} className="font-orbitron text-[10px] tracking-wider bg-primary text-primary-foreground hover:bg-primary/80">
              CLOSE
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="font-mono-share text-[10px] text-muted-foreground leading-relaxed">
              Send XRGE to the platform wallet. 80% goes to the creator's XRGE bank instantly — no waiting for withdrawal review.
            </p>

            {/* Amount */}
            <div>
              <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                SEND_EXACTLY
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 border border-primary/40 rounded bg-card/60 px-3 py-2 font-mono-share text-sm text-primary font-bold select-all">
                  {xrgeAmount} XRGE
                </div>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(xrgeAmount, "amount")} className="border-primary/30 px-2">
                  {copied === "amount" ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Deposit address */}
            <div>
              <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                TO_ADDRESS ({XRGE_CHAIN_NAME} · chain {XRGE_CHAIN_ID})
              </label>
              {depositAddress ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 border border-primary/40 rounded bg-card/60 px-3 py-2 font-mono-share text-[11px] text-foreground/80 break-all select-all">
                    {depositAddress}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(depositAddress, "address")} className="border-primary/30 px-2">
                    {copied === "address" ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="font-mono-share text-xs">Loading...</span>
                </div>
              )}
              {depositAddress && (
                <a
                  href={basescanAddressUrl(depositAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono-share text-[8px] text-primary/70 hover:text-primary mt-1"
                >
                  View on Basescan <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={copyPaymentBlock}
              className="w-full font-mono-share text-[10px] gap-2 border border-pink-500/30 bg-pink-500/10 hover:bg-pink-500/20"
            >
              {copied === "all" ? (
                <><CheckCircle2 className="w-4 h-4 text-green-400" /> COPIED</>
              ) : (
                <><Copy className="w-4 h-4" /> COPY_ALL</>
              )}
            </Button>

            {/* Warning */}
            <div className="flex items-start gap-2 border border-yellow-600/30 rounded p-2 bg-yellow-600/5">
              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
              <p className="font-mono-share text-[9px] text-yellow-500/80 leading-relaxed">
                Send <span className="font-bold text-yellow-500">XRGE tokens on Base chain only</span>.
                Wrong token or chain = permanent loss.
              </p>
            </div>

            {/* Tx hash */}
            <div>
              <label className="font-orbitron text-[9px] tracking-widest text-muted-foreground block mb-1.5">
                TRANSACTION_HASH
              </label>
              <Input
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x..."
                className="font-mono-share text-xs"
                disabled={verifying}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 border border-destructive/30 rounded p-2 bg-destructive/5">
                <AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                <p className="font-mono-share text-[10px] text-destructive">{error}</p>
              </div>
            )}

            <Button
              onClick={handleVerify}
              disabled={!txHash.trim() || verifying || !depositAddress}
              className="w-full font-orbitron text-[10px] tracking-wider bg-secondary text-secondary-foreground hover:bg-secondary/80 gap-2"
            >
              {verifying ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> VERIFYING ON-CHAIN...</>
              ) : (
                "VERIFY & UNLOCK"
              )}
            </Button>

            {txHash.trim() && /^0x[a-fA-F0-9]{64}$/.test(txHash.trim()) && (
              <a
                href={`https://basescan.org/tx/${txHash.trim()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 font-mono-share text-[9px] text-primary/60 hover:text-primary"
              >
                View on Basescan <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <a
              href={XRGE_DEXSCREENER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 font-mono-share text-[8px] text-muted-foreground/50 hover:text-primary"
            >
              Get $XRGE on DexScreener <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default XrgeUnlockDialog;
