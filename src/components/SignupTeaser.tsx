import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles, Zap } from "lucide-react";

/**
 * Teaser shown to logged-out visitors on the feed.
 * Renders 2 sample blurred "locked" cards + a sign-up CTA to drive conversion.
 */
const SAMPLES = [
  {
    user: "@neon_dreamer",
    label: "EXCLUSIVE",
    gradient: "from-primary/40 via-secondary/30 to-accent/40",
  },
  {
    user: "@cyber_muse",
    label: "PREMIUM",
    gradient: "from-secondary/40 via-accent/30 to-primary/40",
  },
];

interface Props {
  variant?: "mobile" | "desktop";
}

const SignupTeaser: React.FC<Props> = ({ variant = "desktop" }) => {
  const navigate = useNavigate();

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-card/80 via-card/60 to-card/40 p-4 sm:p-5 backdrop-blur-sm">
      {/* Decorative scanline */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

      <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 items-stretch">
        {/* Sample locked cards */}
        <div className="flex gap-3 shrink-0 justify-center sm:justify-start">
          {SAMPLES.map((s, i) => (
            <div
              key={i}
              className="relative w-24 h-32 sm:w-28 sm:h-36 rounded-lg overflow-hidden border border-border/40"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${s.gradient} blur-xl scale-110`}
                aria-hidden
              />
              <div className="absolute inset-0 bg-black/30" aria-hidden />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                <div className="bg-black/60 backdrop-blur-sm rounded-full p-2 border border-primary/40">
                  <Lock className="w-4 h-4 text-primary" />
                </div>
                <span className="font-orbitron text-[8px] tracking-widest text-white/90">
                  {s.label}
                </span>
              </div>
              <div className="absolute bottom-1 left-1 right-1 text-center">
                <span className="font-mono-share text-[8px] text-white/70 truncate block">
                  {s.user}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex-1 flex flex-col justify-center gap-2 text-center sm:text-left">
          <div className="flex items-center gap-1.5 justify-center sm:justify-start">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <h3 className="font-orbitron text-xs tracking-widest text-primary">
              UNLOCK THE FEED
            </h3>
          </div>
          <p className="font-mono-share text-[11px] sm:text-xs text-foreground/90 leading-relaxed">
            Join to unlock exclusive posts, follow creators, post your own
            generations, and earn credits daily.
          </p>
          <div className="flex flex-wrap gap-2 items-center justify-center sm:justify-start pt-1">
            <Button
              size="sm"
              onClick={() => navigate("/create?signup=1")}
              className="font-mono-share text-[10px] tracking-wider"
            >
              <Zap className="w-3 h-3 mr-1" /> SIGN UP FREE
            </Button>
            <button
              onClick={() => navigate("/create?signin=1")}
              className="font-mono-share text-[10px] tracking-wider text-muted-foreground hover:text-primary transition-colors px-2 py-1"
            >
              Already have an account? Sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignupTeaser;
