import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Clock, Check, X, Sparkles } from "lucide-react";
import CyberLayout from "@/components/CyberLayout";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface MyApp {
  id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  admin_notes: string | null;
}

const STATUS_META = {
  pending:  { Icon: Clock,     color: "text-amber-400",  border: "border-amber-400/40",  bg: "bg-amber-400/5",  label: "PENDING REVIEW",   blurb: "Your application is in the queue. Admins typically review within 48 hours — we'll email you the moment a decision is made." },
  approved: { Icon: Check,     color: "text-green-400",  border: "border-green-400/40",  bg: "bg-green-400/5",  label: "APPROVED",         blurb: "Welcome to the program. Next step: complete ID + age verification to unlock monetization, then build your AI character." },
  rejected: { Icon: X,         color: "text-destructive",border: "border-destructive/40",bg: "bg-destructive/5",label: "NOT APPROVED",     blurb: "Your application wasn't approved this round. You're welcome to apply again with updated info." },
} as const;

export default function ApplyStatus() {
  const { user, loading: authLoading } = useAuth();
  const [app, setApp] = useState<MyApp | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setApp(null); return; }
    apiFetch<{ application: MyApp | null }>("/creator-applications", {
      method: "POST", body: { action: "mine" },
    })
      .then((r) => setApp(r.application))
      .catch((e) => setError(e?.message || "Failed to load"));
  }, [user, authLoading]);

  return (
    <CyberLayout>
      <main className="min-h-screen px-4 sm:px-8 py-10 max-w-2xl mx-auto">
        <div className="font-mono-share text-[10px] tracking-widest text-secondary mb-2">// CREATOR PROGRAM</div>
        <h1 className="font-orbitron text-2xl sm:text-3xl mb-6">APPLICATION STATUS</h1>

        {authLoading || app === undefined ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !user ? (
          <div className="border border-border/40 rounded-lg p-6 bg-card/40 space-y-3">
            <p className="font-mono-share text-sm text-muted-foreground">Sign in to view your application status.</p>
            <Link to="/apply"><Button>Apply now</Button></Link>
          </div>
        ) : error ? (
          <div className="border border-destructive/40 rounded-lg p-6 bg-destructive/5 font-mono-share text-sm text-destructive">{error}</div>
        ) : !app ? (
          <div className="border border-border/40 rounded-lg p-6 bg-card/40 space-y-3 text-center">
            <Sparkles className="w-8 h-8 text-secondary mx-auto" />
            <p className="font-mono-share text-sm text-muted-foreground">You haven't applied yet.</p>
            <Link to="/apply"><Button>Start application</Button></Link>
          </div>
        ) : (() => {
          const m = STATUS_META[app.status];
          return (
            <div className={`border ${m.border} ${m.bg} rounded-lg p-6 space-y-4`}>
              <div className="flex items-center gap-3">
                <m.Icon className={`w-7 h-7 ${m.color}`} />
                <div>
                  <div className={`font-orbitron text-lg ${m.color}`}>{m.label}</div>
                  <div className="font-mono-share text-[10px] text-muted-foreground">
                    Submitted {new Date(app.created_at).toLocaleDateString()}
                    {app.reviewed_at && ` · Reviewed ${new Date(app.reviewed_at).toLocaleDateString()}`}
                  </div>
                </div>
              </div>
              <p className="font-mono-share text-[12px] text-foreground/80 leading-relaxed">{m.blurb}</p>
              {app.admin_notes && (
                <div className="border-t border-border/40 pt-3">
                  <div className="font-mono-share text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Admin notes</div>
                  <p className="font-mono-share text-[12px] text-foreground/90 whitespace-pre-wrap">{app.admin_notes}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {app.status === "approved" && (
                  <>
                    <Link to="/verification"><Button size="sm">Complete verification</Button></Link>
                    <Link to="/characters"><Button size="sm" variant="outline">Build your character</Button></Link>
                  </>
                )}
                {app.status === "rejected" && (
                  <Link to="/apply"><Button size="sm">Apply again</Button></Link>
                )}
                {app.status === "pending" && (
                  <Link to="/"><Button size="sm" variant="outline">Back to feed</Button></Link>
                )}
              </div>
            </div>
          );
        })()}
      </main>
    </CyberLayout>
  );
}
