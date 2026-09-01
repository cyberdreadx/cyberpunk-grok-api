/**
 * /promo — one screen. Post on AntiReddit, paste the link, ask for credits.
 *
 * Deliberately short: the promo is 20 payouts reviewed by hand, so the page's
 * only jobs are to say whether there are spots left, whether this account
 * qualifies, and to take one URL. No marketing copy.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Check, Clock, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import CyberLayout from "@/components/CyberLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const SUB = "a/gltchrunner";
const SUB_URL = "https://antireddit.com/a/gltchrunner";

interface Claim {
  id: string;
  postUrl: string;
  status: "pending" | "approved" | "rejected";
  creditsAwarded: number;
  rejectReason: string | null;
  createdAt: string;
}

interface PromoState {
  open: boolean;
  slotsRemaining: number;
  creditAmount: number;
  requireCode: boolean;
  minAccountAgeDays: number;
  minRenders: number;
  eligible: boolean;
  reasons: string[];
  accountAgeDays: number;
  renderCount: number;
  myClaim: Claim | null;
}

export default function PromoPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [state, setState] = useState<PromoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [postUrl, setPostUrl] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await apiFetch<PromoState>("/promo-claim"));
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Free credits — GLTCH Runner";
    if (isAuthenticated) load();
    else setLoading(false);
  }, [isAuthenticated, load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiFetch("/promo-claim", {
        method: "POST",
        body: { postUrl: postUrl.trim(), code: code.trim() || undefined },
      });
      toast({ title: "Claim submitted", description: "It's in the queue for review." });
      setPostUrl("");
      setCode("");
      await load();
    } catch (err: any) {
      toast({
        title: "Couldn't submit",
        description: err?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <CyberLayout>
      <div className="min-h-[100dvh] px-4 py-8">
        <div className="max-w-md mx-auto space-y-6">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> BACK
          </button>
          {children}
        </div>
      </div>
    </CyberLayout>
  );

  if (loading) {
    return shell(
      <div className="flex justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>,
    );
  }

  if (!isAuthenticated) {
    return shell(
      <div className="border border-primary/20 rounded-lg p-6 space-y-3">
        <h1 className="font-orbitron text-base text-primary tracking-wider">FREE CREDITS</h1>
        <p className="text-sm text-foreground/80 font-mono leading-relaxed">
          Sign in to claim. Credits land on your GLTCH account.
        </p>
        <Button onClick={() => navigate("/")} className="font-mono text-xs">SIGN IN</Button>
      </div>,
    );
  }

  if (!state) {
    return shell(
      <p className="text-sm text-muted-foreground font-mono">Couldn't load the promo. Try again shortly.</p>,
    );
  }

  const claim = state.myClaim;
  const showForm = state.open && state.eligible && (!claim || claim.status === "rejected");

  return shell(
    <>
      <div className="space-y-2">
        <h1 className="font-orbitron text-lg text-primary tracking-wider">FREE CREDITS</h1>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className={state.slotsRemaining > 0 ? "text-primary" : "text-muted-foreground"}>
            {state.slotsRemaining} of 20 spots left
          </span>
          {state.slotsRemaining === 0 && <span className="text-muted-foreground">· closed</span>}
        </div>
      </div>

      <p className="text-sm text-foreground/80 font-mono leading-relaxed">
        Post one generation or prompt in{" "}
        <a
          href={SUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline inline-flex items-center gap-1"
        >
          {SUB} <ExternalLink className="w-3 h-3" />
        </a>
        . Paste the link. If it looks real I'll add credits. One per account. 20 spots.
      </p>

      {claim && (
        <div
          className={`border rounded-lg p-4 space-y-2 ${claim.status === "approved"
            ? "border-green-500/40 bg-green-500/5"
            : claim.status === "rejected"
              ? "border-destructive/40 bg-destructive/5"
              : "border-primary/30 bg-primary/5"
            }`}
        >
          <div className="flex items-center gap-2 font-mono text-xs">
            {claim.status === "approved" ? (
              <><Check className="w-3.5 h-3.5 text-green-400" /><span className="text-green-400">APPROVED</span></>
            ) : claim.status === "rejected" ? (
              <><X className="w-3.5 h-3.5 text-destructive" /><span className="text-destructive">REJECTED</span></>
            ) : (
              <><Clock className="w-3.5 h-3.5 text-primary" /><span className="text-primary">PENDING REVIEW</span></>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono break-all">{claim.postUrl}</p>
          {claim.status === "approved" && (
            <p className="text-xs text-foreground/80 font-mono">
              {claim.creditsAwarded} credits added to your account.
            </p>
          )}
          {claim.status === "rejected" && (
            <p className="text-xs text-foreground/80 font-mono">
              {claim.rejectReason || "Not approved."} You can submit a different post.
            </p>
          )}
        </div>
      )}

      {!state.open && !claim && (
        <p className="text-sm text-muted-foreground font-mono">
          All 20 spots are taken. Nothing left to claim.
        </p>
      )}

      {state.open && !state.eligible && (
        <div className="border border-border/40 rounded-lg p-4 space-y-2">
          <p className="font-mono text-[11px] text-muted-foreground tracking-wider">NOT YET ELIGIBLE</p>
          <ul className="space-y-1">
            {state.reasons.map((r) => (
              <li key={r} className="text-xs text-foreground/70 font-mono">· {r}</li>
            ))}
          </ul>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className="font-mono text-[10px] tracking-widest text-muted-foreground">
              ANTIREDDIT POST URL
            </label>
            <input
              type="url"
              required
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="https://antireddit.com/a/gltchrunner/..."
              className="w-full bg-muted/50 border border-primary/20 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
            />
          </div>

          {state.requireCode && (
            <div className="space-y-1">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">
                INVITE CODE
              </label>
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="GLTCH-XXXX-XXXX"
                className="w-full bg-muted/50 border border-primary/20 rounded-lg px-3 py-2 text-xs font-mono tracking-widest text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
              />
            </div>
          )}

          <Button type="submit" disabled={submitting} className="w-full font-mono text-xs">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `REQUEST ${state.creditAmount} CREDITS`}
          </Button>
          <p className="text-[10px] text-muted-foreground/70 font-mono text-center">
            Reviewed by hand. Nothing is paid automatically.
          </p>
        </form>
      )}
    </>,
  );
}
