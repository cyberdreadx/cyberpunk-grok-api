/**
 * Polls /api/chat?summary=1 and computes total unread count across channels
 * by comparing each channel's latest ts with localStorage `chat-last-seen-{c}`.
 */
import { useEffect, useState, useCallback } from "react";
import { apiFetch, hasAuthToken } from "@/lib/api";

const POLL_MS = 20_000;
const LS_PREFIX = "chat-last-seen-";

interface ChannelSummary { id: string; count: number; latest: number; }

export function getLastSeen(channel: string): number {
  try { return Number(localStorage.getItem(LS_PREFIX + channel) || 0); } catch { return 0; }
}
export function setLastSeen(channel: string, ts: number) {
  try { localStorage.setItem(LS_PREFIX + channel, String(ts)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("chat-unread-refresh")); } catch { /* ignore */ }
}

export function useChatUnread(enabled: boolean) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled || !hasAuthToken()) { setUnread(0); return; }
    try {
      const data = await apiFetch<{ channels: ChannelSummary[] }>(`/chat?summary=1`);
      if (!data?.channels) return;
      let total = 0;
      for (const c of data.channels) {
        const seen = getLastSeen(c.id);
        // First time visiting: treat all current msgs as seen.
        if (!seen) {
          if (c.latest) setLastSeen(c.id, c.latest);
          continue;
        }
        if (c.latest > seen) total += 1; // count channels with new activity
      }
      setUnread(total);
    } catch { /* silent */ }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setUnread(0); return; }
    refresh();
    const id = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    const onRefresh = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("chat-unread-refresh", onRefresh as EventListener);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("chat-unread-refresh", onRefresh as EventListener);
    };
  }, [enabled, refresh]);

  return { unread, refresh };
}
