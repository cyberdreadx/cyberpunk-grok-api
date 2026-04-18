import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { BadgeCheck, ShieldCheck, CreditCard, Loader2, ExternalLink, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VerificationStatus {
  status: "unverified" | "pending" | "verified" | "lapsed";
  isVerified: boolean;
  onetimePaid: boolean;
  sessionId: string | null;
  subscriptionId: string | null;
  verifiedAt: string | null;
  renewsAt: string | null;
  lapsedAt: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const VerificationDialog: React.FC<Props> = ({ open, onOpenChange }) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch<VerificationStatus>("/verify")
      .then(setStatus)
      .catch((e) => toast({ title: e.message || "Failed to load status", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [open, toast]);

  const startCheckout = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch<{ url: string }>("/verify", { method: "POST", body: { action: "start" } });
      if (res.url) window.location.href = res.url;
    } catch (e: any) {
      toast({ title: e.message || "Could not start checkout", variant: "destructive" });
      setSubmitting(false);
    }
  };

  const startIdentity = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch<{ url: string }>("/verify", { method: "POST", body: { action: "identity" } });
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
      // Re-fetch after a moment in case it was already verified
      setTimeout(() => apiFetch<VerificationStatus>("/verify").then(setStatus).catch(() => {}), 1500);
    } catch (e: any) {
      toast({ title: e.message || "Could not start ID check", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-orbitron">
            <BadgeCheck className="w-5 h-5 text-primary" />
            CREATOR VERIFICATION
          </DialogTitle>
          <DialogDescription className="font-mono-share text-xs">
            Required to set prices on posts/stories and request payouts. Pay the one-time fee + active monthly subscription, then complete a hosted ID check.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : status?.isVerified ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-primary font-orbitron text-sm">
              <BadgeCheck className="w-5 h-5" /> VERIFIED
            </div>
            <p className="font-mono-share text-xs text-muted-foreground">
              You're a verified creator. Monetization and payouts are enabled.
            </p>
            {status.renewsAt && (
              <p className="font-mono-share text-[10px] text-muted-foreground">
                Subscription renews: {new Date(status.renewsAt).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : status?.status === "lapsed" ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-destructive font-orbitron text-sm">
              <AlertCircle className="w-5 h-5" /> LAPSED
            </div>
            <p className="font-mono-share text-xs text-muted-foreground">
              Your verification subscription lapsed. Restart to re-enable monetization &amp; payouts.
            </p>
            <Button onClick={startCheckout} disabled={submitting} className="w-full font-mono-share text-xs">
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <CreditCard className="w-3.5 h-3.5 mr-2" />}
              RE-ACTIVATE VERIFICATION
            </Button>
          </div>
        ) : status?.onetimePaid && status?.status === "pending" ? (
          <div className="space-y-3 py-2">
            <p className="font-mono-share text-xs text-muted-foreground">
              ✓ Payment received. Now complete the hosted ID check.
            </p>
            <Button onClick={startIdentity} disabled={submitting} className="w-full font-mono-share text-xs">
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <ShieldCheck className="w-3.5 h-3.5 mr-2" />}
              START ID CHECK <ExternalLink className="w-3 h-3 ml-2" />
            </Button>
            <p className="font-mono-share text-[10px] text-muted-foreground">
              Opens Stripe's hosted verification flow in a new tab. You'll need a government ID + selfie.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2 font-mono-share text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="text-primary">1.</span>
                <span>Pay the one-time identity check fee + start the monthly verification subscription.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary">2.</span>
                <span>Complete the Stripe-hosted ID + selfie check.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary">3.</span>
                <span>Get the blue check, set prices on content, and unlock payouts.</span>
              </div>
            </div>
            <Button onClick={startCheckout} disabled={submitting} className="w-full font-mono-share text-xs">
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <CreditCard className="w-3.5 h-3.5 mr-2" />}
              CONTINUE TO PAYMENT
            </Button>
            <p className="font-mono-share text-[10px] text-muted-foreground text-center">
              Cancel anytime in the Stripe portal. Verification is revoked immediately if the subscription lapses.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default VerificationDialog;
