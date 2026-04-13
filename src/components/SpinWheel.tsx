import React, { useState, useCallback, useEffect, useRef } from "react";
import { Loader2, Star, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

/* ── Prize segments (must match backend order) ──────────── */
const SEGMENTS = [
  { id: "c5",   label: "5",   color: "hsl(210 60% 18%)" },
  { id: "c10",  label: "10",  color: "hsl(215 65% 12%)" },
  { id: "c5b",  label: "5",   color: "hsl(212 55% 20%)" },
  { id: "c20",  label: "20",  color: "hsl(210 60% 18%)" },
  { id: "c5c",  label: "5",   color: "hsl(215 65% 12%)" },
  { id: "c30",  label: "30",  color: "hsl(212 55% 20%)" },
  { id: "c10b", label: "10",  color: "hsl(210 60% 18%)" },
  { id: "c50",  label: "50",  color: "hsl(215 65% 12%)" },
  { id: "c5d",  label: "5",   color: "hsl(212 55% 20%)" },
  { id: "c100", label: "100", color: "hsl(210 60% 18%)" },
  { id: "c10c", label: "10",  color: "hsl(215 65% 12%)" },
  { id: "c300", label: "300", color: "hsl(220 60% 10%)" },
];

const NUM = SEGMENTS.length;
const ARC = 360 / NUM;

interface SpinWheelProps {
  onCreditsRefresh?: () => void;
}

const SpinWheel: React.FC<SpinWheelProps> = ({ onCreditsRefresh }) => {
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ label: string; credits: number } | null>(null);
  const [freeAvailable, setFreeAvailable] = useState(false);
  const [nextFreeAt, setNextFreeAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotation, setRotation] = useState(0);
  const wheelRef = useRef<HTMLDivElement>(null);

  // Fetch spin state
  const fetchState = useCallback(async () => {
    try {
      const data = await apiFetch("/spin");
      setFreeAvailable(data.freeAvailable);
      setNextFreeAt(data.nextFreeAt);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  // Countdown timer
  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    if (!nextFreeAt) { setCountdown(""); return; }
    const update = () => {
      const diff = new Date(nextFreeAt).getTime() - Date.now();
      if (diff <= 0) { setFreeAvailable(true); setNextFreeAt(null); setCountdown(""); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${h}h ${m}m ${s}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [nextFreeAt]);

  const doSpin = useCallback(async (paid: boolean) => {
    if (spinning) return;
    setSpinning(true);
    setResult(null);

    try {
      const data = await apiFetch("/spin", { method: "POST", body: { paid } });
      const prize = data.prize;

      // Find segment index
      const idx = SEGMENTS.findIndex(s => s.id === prize.id);
      // Calculate target rotation: multiple full spins + land on segment
      // Segment 0 is at top, pointer is at top. We need to rotate so segment `idx` ends at top.
      const segmentAngle = idx * ARC;
      const extraSpins = 5 + Math.floor(Math.random() * 3); // 5-7 full spins
      const targetRotation = rotation + (extraSpins * 360) + (360 - segmentAngle) + (ARC / 2);

      setRotation(targetRotation);

      // Show result after animation
      setTimeout(() => {
        setResult({ label: prize.label, credits: prize.credits });
        setSpinning(false);
        onCreditsRefresh?.();
        fetchState();
      }, 4500);
    } catch (err: any) {
      setSpinning(false);
      setResult(null);
      // Could show error toast here
    }
  }, [spinning, rotation, onCreditsRefresh, fetchState]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4 relative">
      {/* Result overlay */}
      {result && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg animate-fade-in">
          <Star className="w-16 h-16 text-primary fill-primary mb-3 drop-shadow-[0_0_20px_hsl(var(--primary)/0.6)]" />
          <p className="font-orbitron text-xs tracking-widest text-muted-foreground uppercase">You Won</p>
          <p className="font-orbitron text-3xl font-bold neon-text-cyan mt-1">
            {result.credits} CREDITS
          </p>
          <div className="flex flex-col items-center gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResult(null)}
              className="font-mono-share text-xs"
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Pointer triangle */}
      <div className="relative w-[280px] h-[280px] sm:w-[320px] sm:h-[320px]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
          <div className="w-0 h-0 border-l-[12px] border-r-[12px] border-t-[20px] border-l-transparent border-r-transparent border-t-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]" />
        </div>

        {/* Wheel */}
        <div
          ref={wheelRef}
          className="w-full h-full rounded-full border-4 border-primary/30 shadow-[0_0_40px_hsl(var(--primary)/0.15)] overflow-hidden"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? "transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none",
          }}
        >
          <svg viewBox="0 0 200 200" className="w-full h-full">
            {SEGMENTS.map((seg, i) => {
              const startAngle = i * ARC - 90; // -90 so segment 0 starts at top
              const endAngle = startAngle + ARC;
              const startRad = (startAngle * Math.PI) / 180;
              const endRad = (endAngle * Math.PI) / 180;
              const x1 = 100 + 100 * Math.cos(startRad);
              const y1 = 100 + 100 * Math.sin(startRad);
              const x2 = 100 + 100 * Math.cos(endRad);
              const y2 = 100 + 100 * Math.sin(endRad);
              const largeArc = ARC > 180 ? 1 : 0;

              // Text position at midpoint, slightly inward
              const midRad = ((startAngle + endAngle) / 2 * Math.PI) / 180;
              const textR = 65;
              const tx = 100 + textR * Math.cos(midRad);
              const ty = 100 + textR * Math.sin(midRad);
              const textAngle = (startAngle + endAngle) / 2 + 90;

              // Star position
              const starR = 45;
              const sx = 100 + starR * Math.cos(midRad);
              const sy = 100 + starR * Math.sin(midRad);

              return (
                <g key={seg.id}>
                  <path
                    d={`M100,100 L${x1},${y1} A100,100 0 ${largeArc},1 ${x2},${y2} Z`}
                    fill={seg.color}
                    stroke="hsl(210 50% 25%)"
                    strokeWidth="0.5"
                  />
                  {/* Credit label */}
                  <text
                    x={tx}
                    y={ty}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${textAngle}, ${tx}, ${ty})`}
                    fill="white"
                    fontSize="7"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {seg.label}
                  </text>
                  {/* Small star icon */}
                  <text
                    x={sx}
                    y={sy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${textAngle}, ${sx}, ${sy})`}
                    fontSize="8"
                  >
                    ⭐
                  </text>
                  {/* "CREDITS" label at edge */}
                  <text
                    x={100 + 85 * Math.cos(midRad)}
                    y={100 + 85 * Math.sin(midRad)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${textAngle}, ${100 + 85 * Math.cos(midRad)}, ${100 + 85 * Math.sin(midRad)})`}
                    fill="hsl(200 80% 70%)"
                    fontSize="3.5"
                    fontFamily="monospace"
                    letterSpacing="0.5"
                  >
                    CREDITS
                  </text>
                </g>
              );
            })}
            {/* Center circle */}
            <circle cx="100" cy="100" r="8" fill="hsl(210 30% 15%)" stroke="hsl(200 60% 40%)" strokeWidth="1" />
            <circle cx="100" cy="100" r="3" fill="hsl(200 60% 50%)" />
          </svg>
        </div>
      </div>

      {/* Spin buttons */}
      <div className="flex flex-col items-center gap-2 w-full max-w-[280px]">
        {freeAvailable ? (
          <Button
            onClick={() => doSpin(false)}
            disabled={spinning}
            className="w-full font-orbitron text-xs tracking-wider gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white border-0 shadow-[0_0_20px_rgba(34,197,94,0.3)]"
          >
            {spinning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            {spinning ? "Spinning..." : "FREE SPIN"}
          </Button>
        ) : (
          <div className="text-center">
            <p className="font-mono-share text-[10px] text-muted-foreground/60">
              Next free spin in: <span className="text-primary">{countdown || "..."}</span>
            </p>
          </div>
        )}

        <Button
          variant="outline"
          onClick={() => doSpin(true)}
          disabled={spinning}
          className="w-full font-mono-share text-xs gap-2 border-primary/30 hover:bg-primary/10"
        >
          {spinning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-3.5 h-3.5" />}
          Spin Again — 25 Credits
        </Button>
      </div>
    </div>
  );
};

export default SpinWheel;
