import React, { useMemo } from "react";
import {
  getPulseZoneInfo,
  formatPulsePeriod,
  pulseHzToBarPercent,
  pulseZoneSegmentPercents,
  PULSE_HZ_MIN,
  PULSE_HZ_MAX,
} from "@/lib/immersionZones";

interface ImmersionPulseGuideProps {
  hz: number;
}

const ZONE_LABELS = ["Slow", "Moderate", "Elevated", "Very high"] as const;

/**
 * Color-coded Hz map + period (T=1/f) + informational zone badge.
 */
const ImmersionPulseGuide: React.FC<ImmersionPulseGuideProps> = ({ hz }) => {
  const safeHz = typeof hz === "number" && Number.isFinite(hz) ? hz : 0.7;
  const zone = useMemo(() => getPulseZoneInfo(safeHz), [safeHz]);
  const markerPct = useMemo(() => pulseHzToBarPercent(safeHz), [safeHz]);
  const [w1, w2, w3, w4] = useMemo(() => pulseZoneSegmentPercents(), []);

  return (
    <div className="space-y-2 rounded border border-border/40 bg-card/30 px-2 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[9px] font-mono-share">
        <span
          className={`inline-flex items-center rounded border px-1.5 py-0.5 font-orbitron tracking-wide ${zone.badgeClass}`}
        >
          {zone.label}
        </span>
        <span className="text-muted-foreground/80">{zone.rangeLabel}</span>
        <span className="text-primary/70">·</span>
        <span className="text-muted-foreground">
          T ≈ <span className="text-foreground/90">{formatPulsePeriod(safeHz)}</span>
          <span className="text-muted-foreground/60"> / cycle</span>
        </span>
        <span className="text-primary/70">·</span>
        <span className="text-muted-foreground/70">
          {safeHz.toFixed(3)} cycles/s
        </span>
      </div>

      <div className="relative">
        <div className="flex h-2.5 overflow-hidden rounded-md border border-border/30">
          <div className="h-full bg-emerald-500/45" style={{ width: `${w1}%` }} title={`Slow ${PULSE_HZ_MIN}–2 Hz`} />
          <div className="h-full bg-amber-500/45" style={{ width: `${w2}%` }} title="Moderate 2–5 Hz" />
          <div className="h-full bg-orange-500/45" style={{ width: `${w3}%` }} title="Elevated 5–15 Hz" />
          <div className="h-full bg-rose-600/50" style={{ width: `${w4}%` }} title={`Very high 15–${PULSE_HZ_MAX} Hz`} />
        </div>
        <div
          className="pointer-events-none absolute -top-0.5 bottom-0 w-px bg-white shadow-glow-focus"
          style={{ left: `calc(${markerPct}% - 0.5px)` }}
        />
      </div>

      <div
        className="grid text-[7px] font-mono-share uppercase tracking-wider text-muted-foreground/55"
        style={{ gridTemplateColumns: `${w1}fr ${w2}fr ${w3}fr ${w4}fr` }}
      >
        {ZONE_LABELS.map((label) => (
          <span key={label} className="truncate text-center">
            {label}
          </span>
        ))}
      </div>

      <p className="text-[8px] leading-snug text-muted-foreground/75 border-t border-border/20 pt-1.5">
        {zone.note}
      </p>
      <p className="text-[7px] text-muted-foreground/45 leading-snug">
        CSS animation uses <span className="font-mono-share text-muted-foreground/60">duration ≈ 1/f</span> (not lab-grade photic timing).{" "}
        Range <span className="font-mono-share">{PULSE_HZ_MIN}–{PULSE_HZ_MAX} Hz</span>.
      </p>
    </div>
  );
};

export default ImmersionPulseGuide;
