/**
 * Informational zones for pulse frequency (Hz) — UI tuning / research labeling.
 * Not medical calibration; CSS “Hz” is approximate vs lab photic stim.
 */

export const PULSE_HZ_MIN = 0.05;
export const PULSE_HZ_MAX = 30;

export interface PulseZoneInfo {
  id: "slow" | "moderate" | "elevated" | "extreme";
  label: string;
  /** Hz range this zone covers (for display) */
  rangeLabel: string;
  /** Tailwind-friendly accent classes for badge + track hint */
  badgeClass: string;
  barClass: string;
  /** Short science-adjacent note */
  note: string;
}

/** One row: upper bound (Hz) + zone copy. Fields are flat (not nested under `.info`). */
type ZoneRow = { maxHz: number } & PulseZoneInfo;

/** Ordered low → high; boundaries are inclusive on the lower edge. */
const ZONES: ZoneRow[] = [
  {
    maxHz: 2,
    id: "slow",
    label: "Slow",
    rangeLabel: `${PULSE_HZ_MIN}–2 Hz`,
    badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    barClass: "from-emerald-500/60 to-emerald-400/30",
    note: "Slow ambient modulation; period long (e.g. 0.5–20 s). Unlikely to read as rapid flashing.",
  },
  {
    maxHz: 5,
    id: "moderate",
    label: "Moderate",
    rangeLabel: "2–5 Hz",
    badgeClass: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    barClass: "from-amber-500/60 to-amber-400/30",
    note: "Clearly rhythmic; often used in perception / discomfort studies vs slow drift.",
  },
  {
    maxHz: 15,
    id: "elevated",
    label: "Elevated",
    rangeLabel: "5–15 Hz",
    badgeClass: "bg-orange-500/20 text-orange-200 border-orange-500/40",
    barClass: "from-orange-500/60 to-orange-400/30",
    note: "Band where many accessibility / flashing guidelines and PPR discussions focus (context + contrast matter).",
  },
  {
    maxHz: Infinity,
    id: "extreme",
    label: "Very high",
    rangeLabel: `15–${PULSE_HZ_MAX} Hz`,
    badgeClass: "bg-rose-600/25 text-rose-200 border-rose-500/50",
    barClass: "from-rose-600/70 to-rose-500/40",
    note: "Rapid UI modulation; period very short (tens of ms). Use with care for general audiences; full range available for research.",
  },
];

function rowToPulseZone(row: ZoneRow): PulseZoneInfo {
  const { maxHz: _m, ...rest } = row;
  return rest;
}

export function getPulseZoneInfo(hz: number): PulseZoneInfo {
  const h = Number.isFinite(hz) ? Math.max(PULSE_HZ_MIN, Math.min(PULSE_HZ_MAX, hz)) : PULSE_HZ_MIN;
  for (const z of ZONES) {
    if (h <= z.maxHz) {
      return rowToPulseZone(z);
    }
  }
  return rowToPulseZone(ZONES[ZONES.length - 1]!);
}

/** Period of one full cycle: T = 1/f (seconds). */
export function pulsePeriodSeconds(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) return Infinity;
  return 1 / hz;
}

export function formatPulsePeriod(hz: number): string {
  const T = pulsePeriodSeconds(hz);
  if (!Number.isFinite(T) || T > 999) return "—";
  const ms = T * 1000;
  if (ms >= 1000) return `${T.toFixed(2)} s`;
  if (ms >= 1) return `${ms.toFixed(ms >= 10 ? 1 : 2)} ms`;
  return `${(ms * 1000).toFixed(0)} µs`;
}

/** Position 0–100 on the slider for a horizontal zone bar (log-scaled feel: use linear in hz for simplicity). */
export function pulseHzToBarPercent(hz: number): number {
  const h = Math.max(PULSE_HZ_MIN, Math.min(PULSE_HZ_MAX, hz));
  return ((h - PULSE_HZ_MIN) / (PULSE_HZ_MAX - PULSE_HZ_MIN)) * 100;
}

/** Width % of each zone strip (slow | moderate | elevated | extreme), sums ~100. */
export function pulseZoneSegmentPercents(): [number, number, number, number] {
  const R = PULSE_HZ_MAX - PULSE_HZ_MIN;
  return [
    ((2 - PULSE_HZ_MIN) / R) * 100,
    ((5 - 2) / R) * 100,
    ((15 - 5) / R) * 100,
    ((PULSE_HZ_MAX - 15) / R) * 100,
  ];
}
