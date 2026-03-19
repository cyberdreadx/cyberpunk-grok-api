import React from "react";
import GlitchText from "@/components/GlitchText";
import { RefreshCw, AlertTriangle } from "lucide-react";

interface State {
  hasError: boolean;
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught crash:", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const msg = this.state.error?.message ?? "Unknown error";

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        {/* Scanline overlay */}
        <div
          className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, hsl(var(--foreground)) 2px, hsl(var(--foreground)) 3px)",
          }}
        />

        <div className="relative z-10 max-w-md w-full space-y-6 text-center">
          {/* Icon */}
          <div className="flex justify-center">
            <div
              className="w-16 h-16 rounded border border-destructive/50 flex items-center justify-center"
              style={{ boxShadow: "0 0 20px hsl(var(--destructive) / 0.3)" }}
            >
              <AlertTriangle className="w-7 h-7 text-destructive" />
            </div>
          </div>

          {/* Heading */}
          <div className="space-y-1">
            <GlitchText
              text="SYSTEM_CRASH"
              className="font-orbitron text-xl tracking-widest text-destructive"
              glitchIntensity="medium"
            />
            <p className="font-mono-share text-[10px] text-muted-foreground/50 tracking-wider">
              <span className="text-destructive/40">$</span> process exited with fatal exception
            </p>
          </div>

          {/* Error details */}
          <div className="border border-destructive/20 rounded bg-card/60 px-4 py-3 text-left">
            <p className="font-mono-share text-[10px] text-muted-foreground/40 mb-1 tracking-wider">ERROR_MSG</p>
            <p className="font-mono-share text-xs text-destructive/80 break-all leading-relaxed">
              {msg.length > 200 ? msg.slice(0, 200) + "…" : msg}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={this.handleReload}
              className="flex items-center gap-2 px-5 py-2.5 rounded border border-primary/50 bg-primary/5 hover:bg-primary/10 hover:border-primary transition-all font-mono-share text-xs tracking-wider text-primary"
              style={{ boxShadow: "0 0 12px hsl(var(--primary) / 0.15)" }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              RELOAD
            </button>
            <button
              onClick={this.handleGoHome}
              className="flex items-center gap-2 px-5 py-2.5 rounded border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all font-mono-share text-xs tracking-wider text-muted-foreground hover:text-primary"
            >
              GO HOME
            </button>
          </div>

          <p className="font-mono-share text-[9px] text-muted-foreground/30 tracking-widest">
            If this keeps happening, try clearing your browser cache.
          </p>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
