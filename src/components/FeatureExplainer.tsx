import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Globe, Eye, Clock, Lock, AlertTriangle, Sparkles } from "lucide-react";

type ExplainerKey = "feed" | "stories";

interface FeatureExplainerProps {
  feature: ExplainerKey;
  /** Show the dialog (parent-controlled). If undefined, auto-shows once per feature. */
  open?: boolean;
  onClose?: () => void;
}

const STORAGE_PREFIX = "explainer-seen:";

export const hasSeenExplainer = (feature: ExplainerKey): boolean => {
  try { return localStorage.getItem(STORAGE_PREFIX + feature) === "1"; } catch { return false; }
};

export const markExplainerSeen = (feature: ExplainerKey): void => {
  try { localStorage.setItem(STORAGE_PREFIX + feature, "1"); } catch {}
};

const CONTENT: Record<ExplainerKey, {
  title: string;
  tagline: string;
  points: { icon: React.ComponentType<any>; title: string; body: string; tone?: "warn" }[];
}> = {
  feed: {
    title: "Welcome to the Feed",
    tagline: "A public space to share your generations with everyone on the platform.",
    points: [
      { icon: Globe, title: "Everyone can see this", body: "Posts are public to all logged-in users. Don't share anything private, identifying, or that you wouldn't want a stranger to see." },
      { icon: Sparkles, title: "Quality > Quantity", body: "Share work you're proud of. Low-effort spam (random tests, single-word posts) gets downvoted and may be removed." },
      { icon: Lock, title: "You can lock posts", body: "Charge credits, USD, or XRGE for unlocks. Earnings are split: 75% to you (or 80% on XRGE direct)." },
      { icon: AlertTriangle, title: "Rules are enforced", body: "No illegal content, no NCII, no harassment, no doxxing. Posts with 6+ flags are auto-removed. Bans are real.", tone: "warn" },
    ],
  },
  stories: {
    title: "Welcome to Stories",
    tagline: "Share quick, ephemeral updates that disappear after 24 hours.",
    points: [
      { icon: Clock, title: "24-hour lifespan", body: "Stories vanish automatically after a day. Great for in-progress experiments or moments." },
      { icon: Globe, title: "Public to all users", body: "Everyone on the platform can see your stories. Lock them with credits or XRGE if you want them paid-only." },
      { icon: Eye, title: "You can see who watched", body: "Tap the views counter on your own story to see the list of viewers." },
      { icon: AlertTriangle, title: "Same community rules", body: "All Feed rules apply to Stories. Reports trigger removal — don't post anything you wouldn't on the Feed.", tone: "warn" },
    ],
  },
};

const FeatureExplainer: React.FC<FeatureExplainerProps> = ({ feature, open: controlledOpen, onClose }) => {
  const [autoOpen, setAutoOpen] = useState(false);

  useEffect(() => {
    if (controlledOpen !== undefined) return;
    if (!hasSeenExplainer(feature)) {
      // Slight delay so it doesn't fight the page mount
      const t = setTimeout(() => setAutoOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, [feature, controlledOpen]);

  const isOpen = controlledOpen !== undefined ? controlledOpen : autoOpen;

  const handleClose = () => {
    markExplainerSeen(feature);
    setAutoOpen(false);
    onClose?.();
  };

  const data = CONTENT[feature];

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md bg-card border-border/40 z-[10000]">
        <DialogHeader>
          <DialogTitle className="font-orbitron tracking-wider text-foreground">{data.title}</DialogTitle>
          <DialogDescription className="font-mono-share text-xs text-muted-foreground">
            {data.tagline}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {data.points.map((p, i) => {
            const Icon = p.icon;
            const tone = p.tone === "warn" ? "text-destructive" : "text-primary";
            const bg = p.tone === "warn" ? "bg-destructive/10 border-destructive/30" : "bg-primary/5 border-primary/20";
            return (
              <div key={i} className={`flex gap-3 p-2.5 rounded-md border ${bg}`}>
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone}`} />
                <div className="min-w-0">
                  <div className="font-mono-share text-[11px] font-semibold text-foreground">{p.title}</div>
                  <div className="font-mono-share text-[10px] text-muted-foreground leading-relaxed mt-0.5">{p.body}</div>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button onClick={handleClose} className="w-full font-mono-share text-[10px]">
            GOT IT — DON'T SHOW AGAIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FeatureExplainer;
