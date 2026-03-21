import React, { useEffect, useState } from "react";
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
    const statusInterval = setInterval(() => {
      setCurrentStatus((prev) => (prev + 1) % statusMessages.length);
    }, 3000);

    const timeInterval = setInterval(() => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }, 1000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(timeInterval);
    };
  }, []);

  return (
    <>
      {/* Top-left HUD */}
      <div className="fixed top-10 left-4 z-30 font-mono-share text-[9px] text-primary/20 space-y-1 hidden md:block">
        <div className="immersion-flicker">[SYS] {statusMessages[currentStatus]}</div>
        <div className="text-muted-foreground/15">PID: 0x4F7A // {time}</div>
        <div className="text-muted-foreground/10 mt-2">
          {"─".repeat(18)}
        </div>
      </div>

      {/* Top-right HUD */}
      <div className="fixed top-10 right-4 z-30 font-mono-share text-[9px] text-right hidden md:block">
        <div className="text-secondary/20 animate-pulse-glow">◆ xAI GATEWAY</div>
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
        <div>KERNEL: GROK-NN</div>
        <div className="text-primary/15 mt-1">{time}</div>
      </div>
    </>
  );
};

export default HudOverlay;
