/**
 * SupportBotDialog — preset-only AI support.
 *
 * No free-text input. Users tap a button matching their issue and the
 * bot responds based on their account state. This keeps LLM exposure
 * minimal and prevents prompt-injection abuse.
 */

import React, { useState, useCallback } from "react";
import { LifeBuoy, Loader2, Coins, AlertTriangle, RefreshCcw, HelpCircle, X, Bot } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  username?: string | null;
  /** Called after a refund so the parent can refresh the credits hook. */
  onRefunded?: () => void;
}

interface Preset {
  code: string;
  icon: React.ElementType;
  label: (u: string) => string;
  hint?: string;
  tone: "default" | "warn" | "info";
}

const PRESETS: Preset[] = [
  {
    code: "insufficient_balance",
    icon: Coins,
    label: (u) => `@${u} getting insufficient balance error`,
    hint: "Explain my balance and how to top up",
    tone: "default",
  },
  {
    code: "grok_edits_not_working",
    icon: AlertTriangle,
    label: () => "GLTCH Edits not working",
    hint: "Why this happens + how to recover",
    tone: "warn",
  },
  {
    code: "failed_jobs_refund",
    icon: RefreshCcw,
    label: (u) => `@${u} has failed jobs that charged credits incorrectly`,
    hint: "Auto-scan last 24h and refund verified failures",
    tone: "info",
  },
  {
    code: "general_issue",
    icon: HelpCircle,
    label: (u) => `@${u} is having an issue`,
    hint: "Let the bot diagnose from your recent activity",
    tone: "default",
  },
];

const SupportBotDialog: React.FC<Props> = ({ open, onOpenChange, username, onRefunded }) => {
  const [loading, setLoading] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [refunded, setRefunded] = useState<number>(0);
  const [activeCode, setActiveCode] = useState<string | null>(null);

  const u = username || "you";

  const send = useCallback(async (code: string) => {
    setLoading(code);
    setActiveCode(code);
    setReply(null);
    setRefunded(0);
    try {
      const data = await apiFetch<{ reply: string; refunded?: number }>("/support-bot", {
        method: "POST",
        body: { issue_code: code },
      });
      setReply(data.reply);
      if (data.refunded && data.refunded > 0) {
        setRefunded(data.refunded);
        toast.success(`Refunded ${data.refunded} credits`);
        onRefunded?.();
      }
    } catch (err: any) {
      const msg = err?.message || "Support bot failed.";
      setReply(`⚠️ ${msg}`);
      toast.error(msg);
    } finally {
      setLoading(null);
    }
  }, [onRefunded]);

  const reset = () => {
    setReply(null);
    setActiveCode(null);
    setRefunded(0);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md bg-card border-primary/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-orbitron text-primary">
            <Bot className="w-5 h-5" />
            Support Bot
          </DialogTitle>
          <DialogDescription className="font-mono-share text-xs text-muted-foreground/70">
            Pick the issue that matches yours. The bot reads your account state — no typing required.
          </DialogDescription>
        </DialogHeader>

        {!reply && (
          <div className="space-y-2 py-2">
            {PRESETS.map((p) => {
              const Icon = p.icon;
              const isLoading = loading === p.code;
              const toneRing =
                p.tone === "warn" ? "hover:border-yellow-500/50 hover:bg-yellow-500/5"
                : p.tone === "info" ? "hover:border-cyan-400/50 hover:bg-cyan-400/5"
                : "hover:border-primary/50 hover:bg-primary/5";
              return (
                <button
                  key={p.code}
                  disabled={!!loading}
                  onClick={() => send(p.code)}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card/40 text-left transition-all ${toneRing} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    ) : (
                      <Icon className="w-4 h-4 text-primary/80" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono-share text-xs text-foreground/90 leading-snug">
                      {p.label(u)}
                    </div>
                    {p.hint && (
                      <div className="font-mono-share text-[10px] text-muted-foreground/60 mt-0.5">
                        {p.hint}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
            <p className="font-mono-share text-[10px] text-muted-foreground/40 text-center pt-2">
              Custom messages disabled to prevent abuse. For anything outside these options, open a ticket in our{" "}
              <a href="https://discord.gg/CNpWqkFA65" target="_blank" rel="noopener noreferrer" className="text-primary/70 underline">Discord</a>
              {" "}or email <a href="mailto:gltch.app@proton.me" className="text-primary/70 underline">gltch.app@proton.me</a>.
            </p>
          </div>
        )}

        {reply && (
          <div className="space-y-3 py-2">
            {refunded > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10">
                <Coins className="w-4 h-4 text-emerald-400" />
                <span className="font-mono-share text-xs text-emerald-300">
                  +{refunded} credits refunded to your balance
                </span>
              </div>
            )}
            <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
              <div className="flex items-start gap-2">
                <Bot className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="font-mono-share text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {reply}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={reset}
                className="px-3 py-1.5 rounded-md border border-border/50 bg-card/40 hover:border-primary/50 hover:bg-primary/5 font-mono-share text-[11px] text-foreground/80 transition-all"
              >
                ← Back to options
              </button>
              <button
                onClick={() => onOpenChange(false)}
                className="px-3 py-1.5 rounded-md border border-primary/40 bg-primary/10 hover:bg-primary/20 font-mono-share text-[11px] text-primary transition-all"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SupportBotDialog;

/** Floating launcher button — drop anywhere. */
export const SupportBotLauncher: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    aria-label="Open support bot"
    style={{
      // Sit clear of the mobile bottom nav (~64px) + iOS safe area, with a comfy gap.
      bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
      right: "calc(env(safe-area-inset-right, 0px) + 16px)",
    }}
    className="fixed sm:!bottom-6 sm:!right-6 z-30 w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-primary/40 bg-card/90 backdrop-blur-md shadow-lg shadow-primary/10 hover:bg-primary/10 hover:border-primary/70 hover:shadow-primary/30 active:scale-95 transition-all flex items-center justify-center group"
  >
    <LifeBuoy className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
  </button>
);
