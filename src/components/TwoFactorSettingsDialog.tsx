import React, { useEffect, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";

/**
 * Account-level toggle for email-based two-factor authentication.
 * Lives in the header next to the account/delete button.
 */
export default function TwoFactorSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [emailVerified, setEmailVerified] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current 2FA state on mount so the trigger button can reflect status.
  useEffect(() => {
    apiFetch<{ enabled: boolean; email_verified: boolean }>("/auth/two-factor")
      .then((d) => { setEnabled(d.enabled); setEmailVerified(d.email_verified); })
      .catch(() => { /* ignore — keep default Off state */ });
  }, []);

  // Re-fetch when dialog opens to guarantee fresh state.
  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(null);
    apiFetch<{ enabled: boolean; email_verified: boolean }>("/auth/two-factor")
      .then((d) => { setEnabled(d.enabled); setEmailVerified(d.email_verified); })
      .catch((e) => setError(e?.message || "Failed to load settings"))
      .finally(() => setLoading(false));
  }, [open]);

  const toggle = async (next: boolean) => {
    setLoading(true); setError(null);
    try {
      const d = await apiFetch<{ enabled: boolean }>("/auth/two-factor", {
        method: "POST",
        body: { enabled: next },
      });
      setEnabled(d.enabled);
    } catch (e: any) {
      setError(e?.message || "Failed to update");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`font-mono-share text-[10px] gap-1 px-2 border ${
            enabled
              ? "text-primary border-primary/40 hover:bg-primary/10"
              : "text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
          }`}
          title="Two-factor authentication"
        >
          <ShieldCheck className="w-3 h-3" />
          <span className="hidden sm:inline">{enabled ? "2FA ON" : "2FA OFF"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> TWO_FACTOR_AUTH
          </DialogTitle>
          <DialogDescription className="font-mono-share text-xs text-muted-foreground/80">
            Require a 6-digit email code on every new device. Trusted devices skip the
            code for 30 days.
          </DialogDescription>
        </DialogHeader>

        {!emailVerified && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
            <p className="font-mono-share text-[11px] text-amber-400">
              Verify your email first so we can deliver login codes.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between border border-border rounded-md p-3 bg-input/40">
          <div className="space-y-0.5">
            <p className="font-orbitron text-[11px] tracking-wider text-foreground">
              EMAIL 2FA
            </p>
            <p className="font-mono-share text-[10px] text-muted-foreground">
              {enabled ? "Active — codes sent on new devices" : "Disabled"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            <Switch
              checked={enabled}
              disabled={loading || !emailVerified}
              onCheckedChange={toggle}
            />
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
            <p className="font-mono-share text-xs text-destructive">{error}</p>
          </div>
        )}

        <p className="font-mono-share text-[10px] text-muted-foreground/60 leading-relaxed">
          Disabling 2FA also revokes all trusted devices, requiring a fresh sign-in if
          you re-enable it later.
        </p>
      </DialogContent>
    </Dialog>
  );
}
