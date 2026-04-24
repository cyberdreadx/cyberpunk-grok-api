import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  BadgeCheck,
  ShieldCheck,
  CreditCard,
  Loader2,
  ExternalLink,
  AlertCircle,
  Clock,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
  Circle,
  XCircle,
} from "lucide-react";

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

type StepState = "done" | "current" | "pending" | "failed";

const StepRow: React.FC<{
  state: StepState;
  title: string;
  description: string;
  meta?: string | null;
}> = ({ state, title, description, meta }) => {
  const Icon =
    state === "done"
      ? CheckCircle2
      : state === "failed"
      ? XCircle
      : state === "current"
      ? Loader2
      : Circle;

  const colorCls =
    state === "done"
      ? "text-primary"
      : state === "failed"
      ? "text-destructive"
      : state === "current"
      ? "text-accent"
      : "text-muted-foreground";

  return (
    <div className="flex items-start gap-3 rounded-md border border-border/60 bg-card/40 p-3">
      <Icon
        className={`mt-0.5 h-5 w-5 shrink-0 ${colorCls} ${
          state === "current" ? "animate-spin" : ""
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className={`font-orbitron text-xs uppercase tracking-wider ${colorCls}`}>
          {title}
        </div>
        <p className="font-mono-share text-xs text-muted-foreground mt-0.5">
          {description}
        </p>
        {meta && (
          <p className="font-mono-share text-[10px] text-muted-foreground/80 mt-1">
            {meta}
          </p>
        )}
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: VerificationStatus["status"] }> = ({ status }) => {
  const map: Record<
    VerificationStatus["status"],
    { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    verified: {
      label: "VERIFIED",
      cls: "bg-primary/15 text-primary border-primary/40",
      Icon: BadgeCheck,
    },
    pending: {
      label: "IN PROGRESS",
      cls: "bg-accent/15 text-accent border-accent/40",
      Icon: Clock,
    },
    lapsed: {
      label: "LAPSED",
      cls: "bg-destructive/15 text-destructive border-destructive/40",
      Icon: AlertCircle,
    },
    unverified: {
      label: "UNVERIFIED",
      cls: "bg-muted/40 text-muted-foreground border-border",
      Icon: Circle,
    },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-orbitron text-[11px] uppercase tracking-widest ${cls}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
};

const VerificationStatusPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<VerificationStatus>("/verify");
      setStatus(res);
    } catch (e: any) {
      toast({
        title: e?.message || "Failed to load verification status",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate("/profile");
      return;
    }
    load();
  }, [authLoading, isAuthenticated, load, navigate]);

  // After Stripe Checkout success redirect (?paid=1), the webhook may take a
  // moment to flip verification_onetime_paid. Poll a few times so the user
  // sees step 1 turn green without needing to manually refresh.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") !== "1" && params.get("cancelled") !== "1") return;

    if (params.get("cancelled") === "1") {
      toast({ title: "Checkout cancelled", description: "You can restart anytime." });
    } else {
      toast({ title: "Payment received", description: "Finalizing… you can start the ID check next." });
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 8;
    const poll = async () => {
      while (!cancelled && attempts < maxAttempts) {
        attempts++;
        try {
          const res = await apiFetch<VerificationStatus>("/verify");
          if (cancelled) return;
          setStatus(res);
          if (res.onetimePaid || res.isVerified) break;
        } catch {/* ignore */}
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Clean the URL so reload doesn't re-trigger
      const url = new URL(window.location.href);
      url.searchParams.delete("paid");
      url.searchParams.delete("cancelled");
      url.searchParams.delete("session_id");
      window.history.replaceState({}, "", url.toString());
    };
    poll();
    return () => { cancelled = true; };
  }, [authLoading, isAuthenticated, toast]);


  const startCheckout = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch<{ url: string }>("/verify", {
        method: "POST",
        body: { action: "start" },
      });
      if (res.url) window.location.href = res.url;
    } catch (e: any) {
      toast({ title: e?.message || "Could not start checkout", variant: "destructive" });
      setSubmitting(false);
    }
  };

  const startIdentity = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch<{ url: string }>("/verify", {
        method: "POST",
        body: { action: "identity" },
      });
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
      setTimeout(() => load(), 1500);
    } catch (e: any) {
      toast({ title: e?.message || "Could not start ID check", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Derive step states from status
  const paymentState: StepState = !status
    ? "pending"
    : status.onetimePaid || status.isVerified || status.status === "lapsed"
    ? "done"
    : status.status === "pending"
    ? "current"
    : "pending";

  const identityState: StepState = !status
    ? "pending"
    : status.isVerified
    ? "done"
    : status.status === "lapsed"
    ? "failed"
    : status.onetimePaid
    ? "current"
    : "pending";

  const subState: StepState = !status
    ? "pending"
    : status.isVerified
    ? "done"
    : status.status === "lapsed"
    ? "failed"
    : status.subscriptionId
    ? "current"
    : "pending";

  const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/profile")}
            className="font-mono-share text-xs"
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> BACK
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            className="font-mono-share text-xs"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            REFRESH
          </Button>
        </div>

        {/* Title card */}
        <div className="rounded-lg border border-border bg-card/60 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-orbitron text-lg sm:text-xl text-foreground flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-primary" />
                CREATOR VERIFICATION
              </h1>
              <p className="font-mono-share text-xs text-muted-foreground mt-1">
                Required to set prices on posts/stories and request payouts.
              </p>
            </div>
            {status && <StatusBadge status={status.status} />}
          </div>

          {/* Loading */}
          {loading && !status && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Steps */}
          {status && (
            <div className="mt-5 space-y-2.5">
              <StepRow
                state={paymentState}
                title="1. One-time fee paid"
                description="Covers the Stripe Identity document + selfie check."
                meta={
                  status.onetimePaid
                    ? "Payment received."
                    : "Required before you can start the ID check."
                }
              />
              <StepRow
                state={subState}
                title="2. Monthly subscription active"
                description="Keeps your verified status active. Cancel anytime in the Stripe portal."
                meta={
                  status.renewsAt
                    ? `Renews ${fmtDate(status.renewsAt)}`
                    : status.subscriptionId
                    ? "Subscription created — awaiting first invoice."
                    : null
                }
              />
              <StepRow
                state={identityState}
                title="3. Identity check completed"
                description="Government ID + selfie via Stripe's hosted flow."
                meta={
                  status.isVerified && status.verifiedAt
                    ? `Verified ${fmtDate(status.verifiedAt)}`
                    : status.sessionId
                    ? "ID session in progress."
                    : null
                }
              />
            </div>
          )}

          {/* Lapsed banner */}
          {status?.status === "lapsed" && (
            <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="font-mono-share text-xs text-destructive">
                Your verification lapsed{status.lapsedAt ? ` on ${fmtDate(status.lapsedAt)}` : ""}.
                Re-activate to restore monetization &amp; payouts.
              </p>
            </div>
          )}

          {/* Actions */}
          {status && (
            <div className="mt-5 space-y-2">
              {status.isVerified ? (
                <Button
                  variant="secondary"
                  onClick={() => navigate("/profile")}
                  className="w-full font-mono-share text-xs"
                >
                  RETURN TO PROFILE
                </Button>
              ) : status.status === "lapsed" ? (
                <Button
                  onClick={startCheckout}
                  disabled={submitting}
                  className="w-full font-mono-share text-xs"
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CreditCard className="mr-2 h-3.5 w-3.5" />
                  )}
                  RE-ACTIVATE VERIFICATION
                </Button>
              ) : status.onetimePaid ? (
                <Button
                  onClick={startIdentity}
                  disabled={submitting}
                  className="w-full font-mono-share text-xs"
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                  )}
                  START ID CHECK <ExternalLink className="ml-2 h-3 w-3" />
                </Button>
              ) : (
                <Button
                  onClick={startCheckout}
                  disabled={submitting}
                  className="w-full font-mono-share text-xs"
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CreditCard className="mr-2 h-3.5 w-3.5" />
                  )}
                  CONTINUE TO PAYMENT
                </Button>
              )}

              <p className="font-mono-share text-[10px] text-muted-foreground text-center">
                Verification is revoked immediately if the subscription lapses.
              </p>
            </div>
          )}
        </div>

        {/* Debug / IDs */}
        {status && (status.sessionId || status.subscriptionId) && (
          <div className="mt-4 rounded-lg border border-border/60 bg-card/30 p-4">
            <div className="font-orbitron text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              REFERENCE
            </div>
            <dl className="space-y-1 font-mono-share text-[11px] text-muted-foreground">
              {status.subscriptionId && (
                <div className="flex justify-between gap-3">
                  <dt>Subscription</dt>
                  <dd className="truncate">{status.subscriptionId}</dd>
                </div>
              )}
              {status.sessionId && (
                <div className="flex justify-between gap-3">
                  <dt>ID Session</dt>
                  <dd className="truncate">{status.sessionId}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerificationStatusPage;
