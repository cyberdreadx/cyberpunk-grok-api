import React, { useEffect, useState, memo } from "react";
import { APP_VERSION } from "@/lib/version";

const statusMessages = [
  "NEURAL_LINK_ACTIVE",
  "QUANTUM_MESH_SYNCED",
  "FIREWALL: NOMINAL",
  "LATENCY: 0.003ms",
  "ENCRYPTION: AES-512",
  "NODE_CLUSTER: ONLINE",
  "MEMORY: 94.2% FREE",
  "UPLINK: STABLE",
  "THREAT_LEVEL: NULL",
  "BANDWIDTH: ∞",
  "GPU_TEMP: 67°C",
  "RENDER_QUEUE: IDLE",
];

const HudOverlay: React.FC = () => {
  const [currentStatus, setCurrentStatus] = useState(0);
  const [time, setTime] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };
    tick();
    // Slow updates — decorative only; 1s intervals caused unnecessary React re-renders.
    const statusInterval = setInterval(() => {
      setCurrentStatus((prev) => (prev + 1) % statusMessages.length);
    }, 8000);
    const timeInterval = setInterval(tick, 5000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(timeInterval);
    };
  }, []);

  return (
    <div className="cyber-hud-overlay pointer-events-none fixed inset-0 z-30 hidden md:block" aria-hidden>
      {/* Top-left HUD */}
      <div className="fixed left-4 z-30 font-mono-share text-[9px] text-primary/20 space-y-1 hidden md:block" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 44px)' }}>
        <div>[SYS] {statusMessages[currentStatus]}</div>
        <div className="text-muted-foreground/15">PID: 0x4F7A // {time}</div>
        <div className="text-muted-foreground/10 mt-2">
          {"─".repeat(18)}
        </div>
      </div>

      {/* Top-right HUD */}
      <div className="fixed right-4 z-30 font-mono-share text-[9px] text-right hidden md:block" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 44px)' }}>
        <div className="text-secondary/20">◆ xAI GATEWAY</div>
        <div className="text-muted-foreground/15">PROTO: HTTPS/3</div>
      </div>

      {/* Bottom-left coordinates */}
      <div className="fixed bottom-4 left-4 z-30 font-mono-share text-[8px] text-muted-foreground/10 hidden md:block">
        <div>LAT: 37.7749°N</div>
        <div>LNG: 122.4194°W</div>
        <div>ALT: CLASSIFIED</div>
      </div>

      {/* Bottom-right version */}
      <div className="fixed bottom-4 right-4 z-30 font-mono-share text-[8px] text-muted-foreground/10 hidden md:block text-right">
        <div>BUILD: {APP_VERSION}-CYBER</div>
        <div>KERNEL: GLTCH-NN</div>
        <div className="text-primary/15 mt-1">{time}</div>
      </div>
    </div>
  );
};

export default memo(HudOverlay);
