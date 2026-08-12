/**
 * Shared range + granularity picker for the admin charts.
 *
 * Every chart used to be hardcoded to 30 days while the database holds six
 * months, so half the history was unreachable from the UI. One control drives
 * them all, and the choice persists to localStorage so a refresh doesn't
 * bounce back to 30d.
 */

import { useCallback } from "react";
import { CalendarRange } from "lucide-react";

export type RangeDays = number | "all";
export type Bucket = "day" | "week" | "month";

export interface ChartRange {
  days: RangeDays;
  /** null = let the server pick a sensible granularity for the span. */
  bucket: Bucket | null;
}

export const RANGE_PRESETS: { label: string; days: RangeDays }[] = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "ALL", days: "all" },
];

const BUCKETS: { label: string; value: Bucket }[] = [
  { label: "D", value: "day" },
  { label: "W", value: "week" },
  { label: "M", value: "month" },
];

const STORAGE_KEY = "admin-chart-range";

export function loadRange(): ChartRange {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const days = parsed.days === "all" ? "all" : Number(parsed.days);
      if (days === "all" || (Number.isFinite(days) && days > 0)) {
        return { days, bucket: parsed.bucket ?? null };
      }
    }
  } catch { /* corrupt or unavailable storage — fall through to the default */ }
  return { days: 30, bucket: null };
}

export function saveRange(range: ChartRange): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(range)); } catch { /* private mode */ }
}

/** What the server will pick when bucket is left on auto — shown as a hint. */
export function autoBucket(days: RangeDays): Bucket {
  const d = days === "all" ? 3650 : days;
  return d <= 92 ? "day" : d <= 400 ? "week" : "month";
}

export function rangeLabel(days: RangeDays): string {
  return RANGE_PRESETS.find((p) => p.days === days)?.label ?? (days === "all" ? "ALL" : `${days}D`);
}

export default function RangeControl({
  value,
  onChange,
  className = "",
  compact = false,
}: {
  value: ChartRange;
  onChange: (next: ChartRange) => void;
  className?: string;
  compact?: boolean;
}) {
  const set = useCallback(
    (next: ChartRange) => { saveRange(next); onChange(next); },
    [onChange],
  );

  const pill = (active: boolean) =>
    `px-2 py-1 font-mono-share text-[10px] tracking-wider rounded transition-colors ${
      active
        ? "bg-primary/20 text-primary border border-primary/40"
        : "text-muted-foreground/60 border border-transparent hover:text-foreground hover:bg-primary/5"
    }`;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {!compact && (
        <CalendarRange className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
      )}
      <div className="flex items-center gap-0.5 rounded border border-border/30 bg-card/40 p-0.5">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => set({ ...value, days: p.days })}
            className={pill(value.days === p.days)}
            aria-pressed={value.days === p.days}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5 rounded border border-border/30 bg-card/40 p-0.5">
        <button
          type="button"
          onClick={() => set({ ...value, bucket: null })}
          className={pill(value.bucket === null)}
          title={`Auto — ${autoBucket(value.days)} buckets for this span`}
          aria-pressed={value.bucket === null}
        >
          AUTO
        </button>
        {BUCKETS.map((b) => (
          <button
            key={b.value}
            type="button"
            onClick={() => set({ ...value, bucket: b.value })}
            className={pill(value.bucket === b.value)}
            title={`One point per ${b.value}`}
            aria-pressed={value.bucket === b.value}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
