import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, Share, Plus, Smartphone } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";

const PwaInstallBanner: React.FC = () => {
  const { canPrompt, isIos, shouldShow, install, dismiss } = usePwaInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);

  if (!shouldShow) return null;

  /** Portal: CyberLayout `.immersion-screen-host` uses `filter`, which breaks `position: fixed`. */
  const node = (
    <>
      {/* Install banner */}
      <div className="fixed bottom-[72px] left-2 right-2 z-50 sm:hidden animate-slide-up">
        <div className="terminal-block rounded-lg overflow-hidden shadow-glow-ambient">
          <div className="flex items-center gap-3 p-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-primary" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-orbitron text-[10px] tracking-wider text-primary">
                INSTALL APP
              </p>
              <p className="font-mono-share text-[9px] text-muted-foreground/60 mt-0.5">
                Add to home screen for the full experience — faster loads, offline access, no browser bar
              </p>
            </div>

            <button
              onClick={dismiss}
              className="p-1.5 text-muted-foreground/40 hover:text-foreground transition-colors shrink-0 self-start"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex gap-2 px-3 pb-3">
            {canPrompt ? (
              <button
                onClick={install}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded bg-primary text-primary-foreground font-orbitron text-[10px] tracking-wider hover:bg-primary/80 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                INSTALL NOW
              </button>
            ) : isIos ? (
              <button
                onClick={() => setShowIosGuide(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded bg-primary text-primary-foreground font-orbitron text-[10px] tracking-wider hover:bg-primary/80 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                HOW TO INSTALL
              </button>
            ) : (
              <button
                onClick={dismiss}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded border border-primary/30 text-primary font-orbitron text-[10px] tracking-wider hover:bg-primary/10 transition-colors"
              >
                MAYBE LATER
              </button>
            )}
          </div>
        </div>
      </div>

      {/* iOS installation guide overlay */}
      {showIosGuide && (
        <div className="fixed inset-0 z-[60] bg-background/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="terminal-block rounded-lg w-full max-w-sm overflow-hidden animate-slide-up shadow-glow-ambient">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border-b border-primary/15">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-destructive/60" />
                <div className="w-2 h-2 rounded-full bg-neon-yellow/60" />
                <div className="w-2 h-2 rounded-full bg-primary/60" />
              </div>
              <span className="font-mono-share text-[9px] text-muted-foreground/40 flex-1 text-center">
                install@ios:~/guide
              </span>
              <button onClick={() => setShowIosGuide(false)} className="text-muted-foreground/40 hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="font-orbitron text-sm tracking-wider text-primary text-center">
                ADD TO HOME SCREEN
              </p>

              {/* Step 1 */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <span className="font-orbitron text-[10px] text-primary">1</span>
                </div>
                <div>
                  <p className="font-mono-share text-[11px] text-foreground/80">
                    Tap the <Share className="w-3.5 h-3.5 inline text-primary mx-0.5 -mt-0.5" /> Share button in Safari's toolbar
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <span className="font-orbitron text-[10px] text-primary">2</span>
                </div>
                <div>
                  <p className="font-mono-share text-[11px] text-foreground/80">
                    Scroll down and tap <Plus className="w-3.5 h-3.5 inline text-primary mx-0.5 -mt-0.5" /> <span className="text-primary">Add to Home Screen</span>
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <span className="font-orbitron text-[10px] text-primary">3</span>
                </div>
                <div>
                  <p className="font-mono-share text-[11px] text-foreground/80">
                    Tap <span className="text-primary">Add</span> — the app will appear on your home screen
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-primary/10">
                <p className="font-mono-share text-[8px] text-muted-foreground/40 text-center">
                  The app launches fullscreen with no browser bar — faster, cleaner, better.
                </p>
              </div>

              <button
                onClick={() => { setShowIosGuide(false); dismiss(); }}
                className="w-full py-2.5 rounded bg-primary/10 border border-primary/30 text-primary font-orbitron text-[10px] tracking-wider hover:bg-primary/20 transition-colors"
              >
                GOT IT
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
};

export default PwaInstallBanner;
