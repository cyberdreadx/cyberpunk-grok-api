/**
 * Chat unread badge — counts channels with activity newer than the locally
 * stored last-seen timestamp.
 *
 * Channel activity now arrives on the shared /api/pulse loop (usePulse.ts)
 * instead of a dedicated /api/chat?summary=1 timer. The last-seen marks stay in
 * localStorage, so marking a channel seen recomputes from data already in hand
 * and costs no request at all.
 */
import { useEffect, useMemo, useState } from "react";
import { usePulse, refreshPulse } from "@/hooks/usePulse";

const LS_PREFIX = "chat-last-seen-";

export function getLastSeen(channel: string): number {
  try { return Number(localStorage.getItem(LS_PREFIX + channel) || 0); } catch { return 0; }
}
export function setLastSeen(channel: string, ts: number) {
  try { localStorage.setItem(LS_PREFIX + channel, String(ts)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("chat-unread-refresh")); } catch { /* ignore */ }
}

export function useChatUnread(enabled: boolean) {
  const pulse = usePulse(enabled);
  // Bumped when last-seen changes so the memo below recomputes; localStorage
  // isn't reactive on its own.
  const [seenVersion, setSeenVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const onSeen = () => setSeenVersion((v) => v + 1);
    window.addEventListener("chat-unread-refresh", onSeen as EventListener);
    return () => window.removeEventListener("chat-unread-refresh", onSeen as EventListener);
  }, [enabled]);

  const unread = useMemo(() => {
    if (!enabled || !pulse?.channels) return 0;
    let total = 0;
    for (const c of pulse.channels) {
      const seen = getLastSeen(c.id);
      // First visit: treat everything currently there as already seen.
      if (!seen) {
        if (c.latest) setLastSeen(c.id, c.latest);
        continue;
      }
      if (c.latest > seen) total += 1; // count channels with new activity
    }
    return total;
  }, [enabled, pulse, seenVersion]);

  return { unread, refresh: refreshPulse };
}
