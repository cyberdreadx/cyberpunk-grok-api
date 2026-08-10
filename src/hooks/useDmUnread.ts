/**
 * Unread DM count for nav badges.
 *
 * Reads off the shared /api/pulse loop — costs zero additional requests, and
 * the server side is two indexed SUMs over denormalised counters on
 * dm_threads, never a scan of dm_messages.
 */
import { usePulse, refreshPulse } from "@/hooks/usePulse";

export function useDmUnread(enabled: boolean) {
  const pulse = usePulse(enabled);
  return { unread: enabled ? pulse?.dmUnread ?? 0 : 0, refresh: refreshPulse };
}
