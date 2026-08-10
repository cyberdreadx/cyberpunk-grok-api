/**
 * usePulse — one poll loop for the whole app.
 *
 * Previously each badge owned its own timer and its own endpoint:
 *   useCredits            30s → /api/credits
 *   useNotificationUnread 20s → /api/notifications?limit=1
 *   NotificationBell      30s → /api/notifications?limit=1   (duplicate!)
 *   useChatUnread         20s → /api/chat?summary=1
 *
 * That's ~11 requests/min per logged-in tab, and the notification count was
 * being fetched twice on two different clocks. Now there is a single
 * module-level interval hitting /api/pulse, and every consumer subscribes to
 * its result. Adding a new badge (DMs) costs zero additional requests.
 *
 * The loop stops entirely while the tab is hidden and does one immediate
 * refresh when it comes back, so background tabs cost nothing.
 */
import { useEffect, useState } from "react";
import { apiFetch, hasAuthToken } from "@/lib/api";

const POLL_MS = 20_000;

export interface ChannelPulse {
  id: string;
  latest: number;
}

export interface Pulse {
  ts: number;
  credits: {
    total: number;
    daily: number;
    sub: number;
    pack: number;
    tier: string | null;
  };
  notifUnread: number;
  channels: ChannelPulse[];
}

type Listener = (p: Pulse | null) => void;

let current: Pulse | null = null;
let listeners: Listener[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
let wired = false;

function emit() {
  for (const fn of listeners) {
    try {
      fn(current);
    } catch {
      /* a broken consumer must not kill the loop */
    }
  }
}

async function fetchPulse(): Promise<void> {
  if (!hasAuthToken()) {
    if (current !== null) {
      current = null;
      emit();
    }
    return;
  }
  // Coalesce: a focus event landing on top of the interval must not double-fetch.
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const data = await apiFetch<Pulse>("/pulse");
      if (data && typeof data.ts === "number") {
        current = data;
        emit();
      }
    } catch {
      /* silent — a failed poll keeps the last known values */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Force an immediate poll (e.g. right after an action that changes a badge). */
export function refreshPulse() {
  void fetchPulse();
}

function startLoop() {
  if (timer) return;
  timer = setInterval(() => {
    if (document.visibilityState === "visible") void fetchPulse();
  }, POLL_MS);
}

function stopLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void fetchPulse();
      startLoop();
    } else {
      stopLoop();
    }
  });
  window.addEventListener("focus", () => void fetchPulse());
  // Legacy per-badge refresh events still fired by existing components — these
  // genuinely need fresh server state. ("chat-unread-refresh" deliberately is
  // NOT here: marking a channel seen only changes localStorage, so the badge
  // recomputes from the pulse we already hold — no request needed.)
  for (const evt of ["pulse-refresh", "notifications-refresh"]) {
    window.addEventListener(evt, () => void fetchPulse());
  }
}

/**
 * Subscribe to the shared pulse. The loop runs while at least one consumer is
 * mounted and `enabled`, and shuts down when the last one unmounts.
 */
export function usePulse(enabled = true): Pulse | null {
  const [pulse, setPulse] = useState<Pulse | null>(current);

  useEffect(() => {
    if (!enabled) return;
    wire();

    listeners.push(setPulse);
    // Seed from cache so a late-mounting badge doesn't flash empty.
    if (current) setPulse(current);
    void fetchPulse();
    if (document.visibilityState === "visible") startLoop();

    return () => {
      listeners = listeners.filter((l) => l !== setPulse);
      if (listeners.length === 0) stopLoop();
    };
  }, [enabled]);

  return pulse;
}
