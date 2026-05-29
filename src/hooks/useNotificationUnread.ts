/**
 * Polls /api/notifications for unread count (bell badge).
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch, hasAuthToken } from "@/lib/api";

const POLL_MS = 20_000;

export function useNotificationUnread(enabled: boolean) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled || !hasAuthToken()) {
      setUnread(0);
      return;
    }
    try {
      const data = await apiFetch<{ unreadCount: number }>("/notifications?limit=1");
      setUnread(Number(data?.unreadCount) || 0);
    } catch {
      /* silent */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setUnread(0);
      return;
    }
    refresh();
    const id = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    const onRefresh = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("notifications-refresh", onRefresh as EventListener);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("notifications-refresh", onRefresh as EventListener);
    };
  }, [enabled, refresh]);

  return { unread, refresh };
}

export function dispatchNotificationsRefresh() {
  try {
    window.dispatchEvent(new CustomEvent("notifications-refresh"));
  } catch {
    /* ignore */
  }
}
