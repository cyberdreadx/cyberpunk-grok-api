import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

/**
 * GPU service credit light in the terminal bar.
 *
 * Polls /api/runpod-status. Everyone sees the colored dot (green = healthy,
 * yellow = credits low, red = empty, gray = unknown). Admins additionally get
 * the balance / spend / runway in the hover tooltip (the server only returns
 * those numbers to ADMIN_EMAIL).
 */

type Status = "green" | "yellow" | "red" | "unknown";

interface StatusResponse {
  status: Status;
  label: string;
  balanceUsd?: number;
  spendPerHr?: number;
  hoursLeft?: number | null;
}

const COLOR: Record<Status, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
  unknown: "#6b7280",
};

const POLL_MS = 60_000;

const RunpodStatusDot: React.FC = () => {
  const [data, setData] = useState<StatusResponse>({ status: "unknown", label: "GPU status unknown" });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await apiFetch<StatusResponse>("/runpod-status", { auth: true });
        if (alive && r?.status) setData(r);
      } catch {
        // leave last-known state; network blips shouldn't flip the light
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const color = COLOR[data.status] || COLOR.unknown;

  // Build hover text. Admin responses include the dollar figures.
  let title = data.label;
  if (typeof data.balanceUsd === "number") {
    title += ` — $${data.balanceUsd.toFixed(2)} credit`;
    if (typeof data.spendPerHr === "number" && data.spendPerHr > 0) {
      title += ` · $${data.spendPerHr.toFixed(2)}/hr`;
      if (typeof data.hoursLeft === "number") title += ` · ~${data.hoursLeft.toFixed(1)}h left`;
    }
  }

  return (
    <div className="flex items-center gap-1" title={title} aria-label={title}>
      <span
        className={`w-2 h-2 rounded-full ${data.status === "red" || data.status === "yellow" ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color, boxShadow: `0 0 5px ${color}` }}
      />
      <span className="font-mono-share text-[10px] text-muted-foreground/50">GPU</span>
    </div>
  );
};

export default RunpodStatusDot;
