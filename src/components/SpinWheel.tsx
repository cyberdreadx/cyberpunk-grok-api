import React, { useState, useCallback, useEffect, useRef } from "react";
import { Loader2, Star, Coins, Gift, Sparkles, Zap, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

/* ── Prize segments (must match backend order) ──────────── */
const SEGMENTS = [
  { id: "c1a",  label: "1",   color: "hsl(210 60% 18%)",  accent: "hsl(200 80% 60%)" },
  { id: "c2a",  label: "2",   color: "hsl(215 65% 12%)",  accent: "hsl(45 90% 60%)" },
  { id: "c1b",  label: "1",   color: "hsl(212 55% 20%)",  accent: "hsl(200 80% 60%)" },
  { id: "c3",   label: "3",   color: "hsl(210 60% 18%)",  accent: "hsl(150 70% 55%)" },
  { id: "c1c",  label: "1",   color: "hsl(215 65% 12%)",  accent: "hsl(200 80% 60%)" },
  { id: "c5",   label: "5",   color: "hsl(212 55% 20%)",  accent: "hsl(280 70% 65%)" },
  { id: "c2b",  label: "2",   color: "hsl(210 60% 18%)",  accent: "hsl(45 90% 60%)" },
  { id: "c10",  label: "10",  color: "hsl(215 65% 12%)",  accent: "hsl(30 95% 55%)" },
  { id: "c1d",  label: "1",   color: "hsl(212 55% 20%)",  accent: "hsl(200 80% 60%)" },
  { id: "c3b",  label: "3",   color: "hsl(210 60% 18%)",  accent: "hsl(150 70% 55%)" },
  { id: "c2c",  label: "2",   color: "hsl(215 65% 12%)",  accent: "hsl(45 90% 60%)" },
  { id: "c25",  label: "25",  color: "hsl(220 60% 10%)",  accent: "hsl(0 85% 60%)" },
];

const NUM = SEGMENTS.length;
const ARC = 360 / NUM;

interface SpinWheelProps {
  onCreditsRefresh?: () => void;
}

/* ── Streak Badge ──────────────────────────────── */
const StreakBadge: React.FC<{ streak: number; minPrize: number }> = ({ streak, minPrize }) => {
  if (streak <= 0) return null;

  const tier = streak >= 7 ? "🔥" : streak >= 5 ? "⚡" : streak >= 3 ? "✨" : "🌟";

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/20 bg-primary/5">
      <span className="text-sm">{tier}</span>
      <div className="text-left">
        <p className="font-orbitron text-[9px] tracking-wider text-primary">
          {streak}-DAY STREAK
        </p>
        <p className="font-mono-share text-[8px] text-muted-foreground/60">
          Min prize: <span className="text-primary font-bold">{minPrize} credit{minPrize !== 1 ? "s" : ""}</span>
        </p>
      </div>
      {streak >= 5 && (
        <Flame className="w-3.5 h-3.5 text-orange-400 fill-orange-400/50" />
      )}
    </div>
  );
};

const SpinWheel: React.FC<SpinWheelProps> = ({ onCreditsRefresh }) => {
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ label: string; credits: number; streak?: number; minPrize?: number; potContribution?: number } | null>(null);
  const [freeAvailable, setFreeAvailable] = useState(false);
  const [nextFreeAt, setNextFreeAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [streak, setStreak] = useState(0);
  const [nextMinPrize, setNextMinPrize] = useState(1);
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceMsg, setMaintenanceMsg] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);

  const fetchState = useCallback(async () => {
    try {
      const data = await apiFetch("/spin");
      setFreeAvailable(data.freeAvailable);
      setNextFreeAt(data.nextFreeAt);
      setStreak(data.streak ?? 0);
      setNextMinPrize(data.nextMinPrize ?? 1);
      setMaintenance(!!data.freeCreditsDisabled);
      setMaintenanceMsg(data.maintenanceMessage ?? null);
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

  const rotationRef = useRef(0);

  const doSpin = useCallback(async (paid: boolean) => {
    if (spinning) return;
    setSpinning(true);
    setResult(null);
    setShowConfetti(false);

    try {
      const data = await apiFetch("/spin", { method: "POST", body: { paid } });
      const prize = data.prize;

      // Update streak from response
      if (data.streak !== undefined) setStreak(data.streak);

      // Find segment index
      const idx = SEGMENTS.findIndex(s => s.id === prize.id);
      // Segment i center is at (i * ARC + ARC/2) degrees clockwise from top in the SVG.
      // CSS rotate() is clockwise. When wheel rotates R deg, the pointer (fixed at top)
      // points at the segment that was (360 - R%360) degrees from top.
      // So we need: (360 - R%360) = segmentCenter → R%360 = 360 - segmentCenter
      const segmentCenter = idx * ARC + ARC / 2;
      const landAngle = ((360 - segmentCenter) % 360 + 360) % 360;
      const currentRot = rotationRef.current;
      const currentAngle = ((currentRot % 360) + 360) % 360;
      const diff = ((landAngle - currentAngle) % 360 + 360) % 360;
      const extraSpins = 5 + Math.floor(Math.random() * 3);
      const targetRotation = currentRot + extraSpins * 360 + diff;

      rotationRef.current = targetRotation;
      setRotation(targetRotation);

      // Show result after animation
      setTimeout(() => {
        setResult({
          label: prize.label,
          credits: prize.credits,
          streak: data.streak,
          minPrize: data.minPrize,
          potContribution: data.potContribution || 0,
        });
        setShowConfetti(prize.credits >= 5);
        setSpinning(false);
        onCreditsRefresh?.();
        fetchState();
      }, 4500);
    } catch (err: any) {
      setSpinning(false);
      setResult(null);
    }
  }, [spinning, onCreditsRefresh, fetchState]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const isJackpot = result && result.credits >= 10;

  return (
    <div className="flex flex-col items-center gap-4 py-4 relative">
      {/* Confetti / sparkle effect for big wins */}
      {showConfetti && (
        <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full animate-ping"
              style={{
                left: `${10 + Math.random() * 80}%`,
                top: `${10 + Math.random() * 80}%`,
                backgroundColor: ['hsl(0 80% 60%)', 'hsl(45 90% 60%)', 'hsl(140 60% 50%)', 'hsl(210 80% 60%)', 'hsl(330 70% 60%)', 'hsl(270 60% 65%)'][i % 6],
                animationDelay: `${Math.random() * 0.5}s`,
                animationDuration: `${0.8 + Math.random() * 0.5}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Result overlay */}
      {result && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/90 backdrop-blur-md rounded-lg animate-fade-in">
          {isJackpot ? (
            <>
              <div className="relative">
                <Sparkles className="w-20 h-20 text-yellow-400 fill-yellow-400 mb-2 drop-shadow-[0_0_30px_rgba(250,204,21,0.8)]" />
                <Zap className="absolute top-2 right-2 w-6 h-6 text-orange-400 fill-orange-400 animate-bounce" />
              </div>
              <p className="font-orbitron text-xs tracking-[0.3em] text-yellow-400 uppercase">
                🎉 JACKPOT! 🎉
              </p>
            </>
          ) : (
            <>
              <Gift className="w-14 h-14 text-primary fill-primary/20 mb-2 drop-shadow-[0_0_20px_hsl(var(--primary)/0.6)]" />
              <p className="font-orbitron text-xs tracking-widest text-muted-foreground uppercase">
                You Won
              </p>
            </>
          )}
          <p className={`font-orbitron text-3xl font-bold mt-1 ${isJackpot ? "text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.5)]" : "neon-text-cyan"}`}>
            +{result.credits} CREDITS
          </p>
          {/* Streak info in result */}
          {result.streak && result.streak > 0 && (
            <p className="font-mono-share text-[10px] text-primary/80 mt-1.5">
              🔥 {result.streak}-day streak • min {result.minPrize} credit{(result.minPrize ?? 1) !== 1 ? "s" : ""}
            </p>
          )}
          <p className="font-mono-share text-[10px] text-muted-foreground/60 mt-0.5">
            Added to your balance
          </p>
          {result.potContribution ? (
            <p className="font-mono-share text-[10px] text-fuchsia-400/90 mt-1.5">
              💧 +{result.potContribution} credit dropped into the Community Pot
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setResult(null); setShowConfetti(false); }}
            className="font-mono-share text-xs mt-4"
          >
            {freeAvailable ? "Spin Again!" : "Close"}
          </Button>
        </div>
      )}

      {/* Header + Streak */}
      <div className="text-center flex flex-col items-center gap-2">
        <div>
          <p className="font-orbitron text-[10px] tracking-[0.2em] text-primary/80 uppercase">Daily Reward</p>
          <p className="font-mono-share text-[9px] text-muted-foreground/50 mt-0.5">Spin to win free credits!</p>
        </div>
        <StreakBadge streak={streak} minPrize={nextMinPrize} />
      </div>

      {/* Pointer triangle */}
      <div className="relative w-[260px] h-[260px] sm:w-[300px] sm:h-[300px]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
          <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-t-[18px] border-l-transparent border-r-transparent border-t-yellow-400 drop-shadow-[0_0_12px_rgba(250,204,21,0.7)]" />
        </div>

        {/* Outer glow ring */}
        <div className={`absolute inset-[-4px] rounded-full ${spinning ?"" :""}`}
          style={{ background: "conic-gradient(from 0deg, hsl(200 80% 50% / 0.3), hsl(280 70% 50% / 0.3), hsl(45 90% 50% / 0.3), hsl(200 80% 50% / 0.3))", filter: "blur(6px)" }}
        />

        {/* Wheel */}
        <div
          ref={wheelRef}
          className="w-full h-full rounded-full border-2 border-primary/40 shadow-[0_0_40px_hsl(var(--primary)/0.15)] overflow-hidden relative"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? "transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none",
          }}
        >
          <svg viewBox="0 0 200 200" className="w-full h-full">
            {SEGMENTS.map((seg, i) => {
              const startAngle = i * ARC - 90;
              const endAngle = startAngle + ARC;
              const startRad = (startAngle * Math.PI) / 180;
              const endRad = (endAngle * Math.PI) / 180;
              const x1 = 100 + 100 * Math.cos(startRad);
              const y1 = 100 + 100 * Math.sin(startRad);
              const x2 = 100 + 100 * Math.cos(endRad);
              const y2 = 100 + 100 * Math.sin(endRad);
              const largeArc = ARC > 180 ? 1 : 0;

              const midRad = ((startAngle + endAngle) / 2 * Math.PI) / 180;
              const textR = 60;
              const tx = 100 + textR * Math.cos(midRad);
              const ty = 100 + textR * Math.sin(midRad);
              const textAngle = (startAngle + endAngle) / 2 + 90;

              const iconR = 82;
              const ix = 100 + iconR * Math.cos(midRad);
              const iy = 100 + iconR * Math.sin(midRad);

              const isHighValue = parseInt(seg.label) >= 10;

              return (
                <g key={seg.id}>
                  <path
                    d={`M100,100 L${x1},${y1} A100,100 0 ${largeArc},1 ${x2},${y2} Z`}
                    fill={seg.color}
                    stroke="hsl(210 50% 30%)"
                    strokeWidth="0.3"
                  />
                  <text
                    x={tx} y={ty}
                    textAnchor="middle" dominantBaseline="central"
                    transform={`rotate(${textAngle}, ${tx}, ${ty})`}
                    fill={isHighValue ? seg.accent : "white"}
                    fontSize={isHighValue ? "9" : "7"}
                    fontFamily="monospace" fontWeight="bold"
                  >
                    {seg.label}
                  </text>
                  <text
                    x={ix} y={iy}
                    textAnchor="middle" dominantBaseline="central"
                    transform={`rotate(${textAngle}, ${ix}, ${iy})`}
                    fontSize="5"
                    opacity={isHighValue ? 1 : 0.5}
                  >
                    {isHighValue ? "💎" : "🪙"}
                  </text>
                </g>
              );
            })}
            <circle cx="100" cy="100" r="12" fill="hsl(210 30% 12%)" stroke="hsl(200 60% 40%)" strokeWidth="1" />
            <text x="100" y="100" textAnchor="middle" dominantBaseline="central" fontSize="6" fill="hsl(200 60% 60%)">🎰</text>
          </svg>
        </div>
      </div>

      {/* Spin buttons */}
      <div className="flex flex-col items-center gap-2 w-full max-w-[260px]">
        {maintenance ? (
          <div className="w-full text-center px-3 py-2 rounded-md border border-yellow-500/30 bg-yellow-500/5">
            <p className="font-orbitron text-[10px] tracking-widest text-yellow-400 uppercase">
              ⚠ Down for maintenance
            </p>
            <p className="font-mono-share text-[9px] text-muted-foreground mt-1">
              {maintenanceMsg || "Free spins are temporarily paused."}
            </p>
          </div>
        ) : freeAvailable ? (
          <Button
            onClick={() => doSpin(false)}
            disabled={spinning}
            className="w-full font-orbitron text-xs tracking-wider gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white border-0 shadow-[0_0_20px_rgba(34,197,94,0.3)] h-11"
          >
            {spinning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
            {spinning ? "Spinning..." : `🎁 FREE SPIN${streak > 0 ? ` (${streak}🔥)` : ""}`}
          </Button>
        ) : (
          <div className="text-center py-1">
            <p className="font-mono-share text-[10px] text-muted-foreground/60">
              Next free spin: <span className="text-primary font-bold">{countdown || "..."}</span>
            </p>
            {streak > 0 && (
              <p className="font-mono-share text-[8px] text-muted-foreground/40 mt-0.5">
                ⚠️ Spin within 48h to keep your streak!
              </p>
            )}
          </div>
        )}

        <Button
          variant="outline"
          onClick={() => doSpin(true)}
          disabled={spinning}
          className="w-full font-mono-share text-xs gap-2 border-primary/30 hover:bg-primary/10 h-9"
        >
          {spinning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-3.5 h-3.5" />}
          Extra Spin — 10 Credits
        </Button>

        <p className="font-mono-share text-[8px] text-muted-foreground/30 text-center mt-1">
          Win 1–25 credits per spin • Streak boosts minimum prize
        </p>
      </div>
    </div>
  );
};

export default SpinWheel;
