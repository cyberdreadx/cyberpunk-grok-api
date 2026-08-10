/**
 * Unread notification count for the bell badge.
 *
 * No longer polls /api/notifications on its own clock — the count rides along
 * on the shared /api/pulse loop (see usePulse.ts), which also serves the chat
 * badge and the credit balance.
 */
import { useCallback } from "react";
import { usePulse, refreshPulse } from "@/hooks/usePulse";

/** Ask every notification consumer to re-check. Call after marking read. */
export function dispatchNotificationsRefresh() {
  try {
    window.dispatchEvent(new CustomEvent("notifications-refresh"));
  } catch {
    /* ignore */
  }
}

export function useNotificationUnread(enabled: boolean) {
  const pulse = usePulse(enabled);
  const refresh = useCallback(async () => {
    refreshPulse();
  }, []);

  return { unread: enabled ? pulse?.notifUnread ?? 0 : 0, refresh };
}
