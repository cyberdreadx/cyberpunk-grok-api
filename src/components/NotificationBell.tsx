import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, MessageCircle, UserPlus, ThumbsUp, Unlock, Coins, Info } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { dispatchNotificationsRefresh, useNotificationUnread } from "@/hooks/useNotificationUnread";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  actor_username: string | null;
  actor_avatar_url: string | null;
  ref_id: string | null;
  read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  comment: <MessageCircle className="w-3.5 h-3.5 text-primary" />,
  follow: <UserPlus className="w-3.5 h-3.5 text-green-400" />,
  upvote: <ThumbsUp className="w-3.5 h-3.5 text-yellow-400" />,
  unlock: <Unlock className="w-3.5 h-3.5 text-purple-400" />,
  credits: <Coins className="w-3.5 h-3.5 text-emerald-400" />,
  system: <Info className="w-3.5 h-3.5 text-muted-foreground" />,
};

interface NotificationBellProps {
  isAuthenticated: boolean;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ isAuthenticated }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setLoading(true);
      const data = await apiFetch("/notifications?limit=30");
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
      dispatchNotificationsRefresh();
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Unread count comes from the shared /api/pulse loop — no dedicated timer and
  // no /api/notifications hit just to read one number. Local setUnreadCount calls
  // elsewhere in this component stay for optimistic updates; the next pulse
  // reconciles them.
  const { unread: pulseUnread } = useNotificationUnread(isAuthenticated);
  useEffect(() => {
    setUnreadCount(pulseUnread);
  }, [pulseUnread]);

  // Fetch full list when opened
  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  // Close on outside click — must check both the trigger wrapper AND the
  // floating popover (which is portaled out of `panelRef` via `fixed` positioning).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = panelRef.current?.contains(target);
      const inPopover = popoverRef.current?.contains(target);
      if (!inTrigger && !inPopover) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markAllRead = async () => {
    try {
      await apiFetch("/notifications", { method: "PATCH", body: { all: true } });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      dispatchNotificationsRefresh();
    } catch {}
  };

  const handleClick = async (n: Notification) => {
    setOpen(false);
    // Mark as read (optimistic)
    if (!n.read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      setUnreadCount(c => Math.max(0, c - 1));
      dispatchNotificationsRefresh();
      apiFetch("/notifications", { method: "PATCH", body: { ids: [n.id] } }).catch(() => {});
    }
    // Route based on type
    if (n.type === "follow" && n.actor_username) {
      navigate(`/profile/${n.actor_username}`);
      return;
    }
    if (n.ref_id && (n.type === "comment" || n.type === "upvote" || n.type === "unlock")) {
      // Stash target so FeedPage opens ReelViewer focused on this post
      try {
        sessionStorage.setItem("openReelPostId", n.ref_id);
      } catch {}
      navigate("/feed");
      // Notify FeedPage if already mounted
      window.dispatchEvent(new CustomEvent("open-reel", { detail: { postId: n.ref_id } }));
    }
  };

  if (!isAuthenticated) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md hover:bg-primary/10 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile backdrop — taps outside close the panel */}
          <div
            className="fixed inset-0 z-40 sm:hidden bg-background/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={popoverRef}
            className="
              fixed sm:absolute z-50 flex flex-col overflow-hidden
              bg-card border border-border/30 rounded-lg shadow-glow-ambient
              left-2 right-2 top-[calc(env(safe-area-inset-top,0px)+32px)] max-h-[70vh]
              sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[320px] sm:max-h-[400px]
            "
          >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
            <span className="font-orbitron text-[10px] tracking-wider text-foreground uppercase">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="font-mono-share text-[9px] text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
              >
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scrollbar-cyber">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-8">
                <Bell className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="font-mono-share text-[10px] text-muted-foreground/50">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 border-b border-border/10 hover:bg-primary/10 transition-colors ${
                    !n.read ? "bg-primary/5" : ""
                  }`}
                >
                  {/* Actor avatar or type icon */}
                  {n.actor_avatar_url ? (
                    <Avatar className="w-7 h-7 shrink-0 mt-0.5">
                      <AvatarImage src={n.actor_avatar_url} />
                      <AvatarFallback className="bg-primary/10 text-primary font-orbitron text-[8px]">
                        {(n.actor_username || "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="w-7 h-7 shrink-0 mt-0.5 rounded-full bg-muted/30 flex items-center justify-center">
                      {TYPE_ICONS[n.type] || TYPE_ICONS.system}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-mono-share text-[11px] text-foreground/90 leading-snug">
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="font-mono-share text-[10px] text-muted-foreground/60 truncate mt-0.5">
                        {n.body}
                      </p>
                    )}
                    <p className="font-mono-share text-[8px] text-muted-foreground/40 mt-0.5">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  {!n.read && (
                    <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </button>
              ))
            )}
          </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationBell;
