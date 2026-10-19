/**
 * EditionsPromoDialog — a one-time popup telling signed-in users about the
 * other editions (Studio, Web3). Accounts are shared, so it's one click away.
 *
 * Shown once per browser, a few seconds after a signed-in session settles, and
 * only if nothing else has interrupted this visit (changelog, tours). Studio
 * never shows it: it's the SFW consumer edition and shouldn't send people to
 * the uncensored ones.
 *
 * Private by design: the dismissal lives in localStorage only, and the links
 * carry no user id or tracking parameter. Bump the key's version to re-announce.
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isStudio, OTHER_EDITIONS } from "@/lib/edition";
import { claimInterruption } from "@/lib/interruptions";

const SEEN_KEY = "gltch-editions-promo-seen-v1";
const DELAY_MS = 8000;

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ }
}

export default function EditionsPromoDialog({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || isStudio || seen()) return;
    const t = window.setTimeout(() => {
      // Never stack on top of another open dialog.
      if (document.querySelector("[role=dialog]")) return;
      if (!claimInterruption()) return;
      markSeen();
      setOpen(true);
    }, DELAY_MS);
    return () => window.clearTimeout(t);
  }, [enabled]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md border-primary/40 bg-background/95">
        <DialogHeader>
          <DialogTitle className="font-orbitron tracking-widest text-primary">ONE ACCOUNT, MORE WAYS IN</DialogTitle>
          <DialogDescription className="font-mono-share text-xs">
            Your account, credits and library work on every GLTCH edition. Just sign in with the same email.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {OTHER_EDITIONS.map((e) => (
            <a
              key={e.id}
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="group block rounded-md border border-primary/25 bg-primary/5 p-3 hover:border-primary/60 hover:bg-primary/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-orbitron text-sm tracking-wider text-foreground">{e.name}</span>
                <span className="font-mono-share text-tiny uppercase tracking-widest text-secondary">{e.tagline}</span>
              </div>
              <p className="mt-1 font-mono-share text-xs text-muted-foreground">{e.pitch}</p>
              <span className="mt-2 inline-flex items-center gap-1 font-orbitron text-tiny tracking-wider text-primary group-hover:underline">
                OPEN {e.name.toUpperCase()} <ExternalLink className="h-3 w-3" />
              </span>
            </a>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-1 w-full rounded-md border border-border py-2 font-mono-share text-xs text-muted-foreground hover:text-foreground"
        >
          Maybe later. It's always in the ☰ menu.
        </button>
      </DialogContent>
    </Dialog>
  );
}
