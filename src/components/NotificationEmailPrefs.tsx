/**
 * Email notification preferences panel (rendered inside PreferencesDialog).
 *
 * Mirrors api/notification-prefs.ts. Loads lazily — only when the settings
 * dialog is actually open — so it never adds to the app's startup requests.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

interface Prefs {
  emailEnabled: boolean;
  types: Record<string, boolean>;
  available: string[];
}

/** Human labels for the notification types the API exposes. */
const LABELS: Record<string, string> = {
  comment: "Comments on my posts",
  follow: "New followers",
  unlock: "Someone unlocked my content",
  dm: "Direct messages",
  upvote: "Upvotes on my posts",
  credits: "Daily credits ready",
  system: "Account & service notices",
};

const NotificationEmailPrefs: React.FC = () => {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<Prefs>("/notification-prefs");
        if (!cancelled) setPrefs(data);
      } catch {
        /* leave null — section renders nothing rather than a broken control */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (patch: { emailEnabled?: boolean; types?: Record<string, boolean> }) => {
    setSaving(true);
    // Optimistic — the toggle should feel instant; a failure re-syncs below.
    setPrefs((p) => p && {
      ...p,
      emailEnabled: patch.emailEnabled ?? p.emailEnabled,
      types: { ...p.types, ...(patch.types || {}) },
    });
    try {
      const data = await apiFetch<Prefs>("/notification-prefs", { method: "PATCH", body: patch });
      setPrefs(data);
    } catch {
      toast.error("Couldn't save notification settings");
      try {
        setPrefs(await apiFetch<Prefs>("/notification-prefs"));
      } catch { /* give up quietly */ }
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading || !prefs) return null;

  return (
    <section className="space-y-2 pt-4 border-t border-border/30">
      <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Mail className="w-3 h-3" />
        EMAIL NOTIFICATIONS
      </label>

      <button
        type="button"
        onClick={() => save({ emailEnabled: !prefs.emailEnabled })}
        disabled={saving}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-border/50 bg-card/40 text-[11px] font-mono-share disabled:opacity-60"
      >
        <span className="text-foreground/80">Send me notification emails</span>
        <span
          className={`px-2 py-0.5 rounded text-[9px] tracking-widest border ${
            prefs.emailEnabled
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          {prefs.emailEnabled ? "ON" : "OFF"}
        </span>
      </button>

      {prefs.emailEnabled && (
        <div className="space-y-1 pt-1">
          {prefs.available.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => save({ types: { [type]: !prefs.types[type] } })}
              disabled={saving}
              className="w-full flex items-center justify-between gap-2 px-2 py-1 text-[10px] font-mono-share text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
            >
              <span>{LABELS[type] || type}</span>
              <span
                className={`w-7 h-3.5 rounded-full relative transition-colors ${
                  prefs.types[type] ? "bg-primary/60" : "bg-muted-foreground/25"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-background transition-all ${
                    prefs.types[type] ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="font-mono-share text-[9px] text-muted-foreground/50 leading-relaxed">
        Account and security emails (verification, 2FA, receipts) are always sent.
      </p>
    </section>
  );
};

export default NotificationEmailPrefs;
