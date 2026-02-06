import React from "react";

interface CyberLayoutProps {
  children: React.ReactNode;
}

const CyberLayout: React.FC<CyberLayoutProps> = ({ children }) => {
  return (
    <div className="relative min-h-screen cyber-gradient overflow-hidden">
      {/* Scanline overlay */}
      <div className="fixed inset-0 scanline z-10" />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.04] z-0"
        style={{
          backgroundImage: `
            linear-gradient(hsl(var(--neon-cyan)) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--neon-cyan)) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Corner accents */}
      <div className="fixed top-0 left-0 w-32 h-32 border-l-2 border-t-2 border-primary/30 z-20" />
      <div className="fixed top-0 right-0 w-32 h-32 border-r-2 border-t-2 border-secondary/30 z-20" />
      <div className="fixed bottom-0 left-0 w-32 h-32 border-l-2 border-b-2 border-secondary/30 z-20" />
      <div className="fixed bottom-0 right-0 w-32 h-32 border-r-2 border-b-2 border-primary/30 z-20" />

      {/* Main content */}
      <div className="relative z-20">{children}</div>
    </div>
  );
};

export default CyberLayout;
