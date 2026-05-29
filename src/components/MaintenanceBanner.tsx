import React, { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

const MaintenanceBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="relative z-50 flex items-center justify-center gap-3 px-4 py-2.5 bg-[hsl(0_80%_20%)] border-b border-[hsl(0_80%_35%)] text-[hsl(0_0%_100%)] font-orbitron text-[11px] tracking-widest uppercase">
      <AlertTriangle className="w-4 h-4 shrink-0 text-[hsl(55_100%_55%)]" />
      <span className="text-center leading-tight">
        GLTCH runner is changing servers &amp; hosting — back shortly
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors ml-1"
        aria-label="Dismiss banner"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default MaintenanceBanner;
