/**
 * /api/runpod-status — GPU service credit light.
 *
 * Public: returns only a coarse status color (green / yellow / red / unknown)
 * so a status dot can be shown to everyone without exposing billing.
 * Admin (ADMIN_EMAIL): also returns the actual balance, spend/hr, and runway.
 *
 * Thresholds are env-overridable:
 *   RUNPOD_EMPTY_USD (default 5)  — at/below = red
 *   RUNPOD_LOW_USD   (default 25) — at/below = yellow
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { getRunpodBalance, isRunpodBalanceConfigured } from "./_lib/runpod-balance";

type Status = "green" | "yellow" | "red" | "unknown";

const EMPTY_USD = Number(process.env.RUNPOD_EMPTY_USD) || 5;
const LOW_USD = Number(process.env.RUNPOD_LOW_USD) || 25;

function colorFor(balanceUsd: number): Status {
  if (balanceUsd <= EMPTY_USD) return "red";
  if (balanceUsd <= LOW_USD) return "yellow";
  return "green";
}

const LABELS: Record<Status, string> = {
  green: "GPU service online",
  yellow: "GPU credits low",
  red: "GPU credits empty",
  unknown: "GPU status unknown",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  // Don't let intermediaries cache the light for long.
  res.setHeader("Cache-Control", "public, max-age=30");

  if (!isRunpodBalanceConfigured()) {
    return res.status(200).json({ status: "unknown" as Status, label: LABELS.unknown });
  }

  const balance = await getRunpodBalance();
  if (!balance) {
    return res.status(200).json({ status: "unknown" as Status, label: LABELS.unknown });
  }

  const status = colorFor(balance.balanceUsd);
  const isAdmin = getUserFromRequest(req)?.email === ADMIN_EMAIL;

  if (!isAdmin) {
    return res.status(200).json({ status, label: LABELS[status] });
  }

  // Admin gets the numbers. Runway uses current spend/hr when actively burning.
  const hoursLeft = balance.spendPerHr > 0 ? balance.balanceUsd / balance.spendPerHr : null;
  return res.status(200).json({
    status,
    label: LABELS[status],
    balanceUsd: Math.round(balance.balanceUsd * 100) / 100,
    spendPerHr: Math.round(balance.spendPerHr * 100) / 100,
    hoursLeft: hoursLeft === null ? null : Math.round(hoursLeft * 10) / 10,
    thresholds: { lowUsd: LOW_USD, emptyUsd: EMPTY_USD },
  });
}
