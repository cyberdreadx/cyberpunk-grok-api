/**
 * Persistent CHAT entry for desktop.
 *
 * Mobile has always had a chatroom tab with an unread badge in MobileBottomNav,
 * but that nav is `sm:hidden`. On desktop the only route to /chat was buried
 * inside a hamburger drawer, so the chatroom was effectively invisible. This is
 * the desktop counterpart — same destination, same unread badge, always on
 * screen. Hidden below `sm` so it never doubles up with the bottom nav.
 */
import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MessagesSquare } from "lucide-react";
import { useChatUnread } from "@/hooks/useChatUnread";
import { useAuth } from "@/hooks/useAuth";

const DesktopChatLink: React.FC<{ className?: string }> = ({ className = "" }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { unread } = useChatUnread(!!isAuthenticated);

  if (!isAuthenticated) return null;

  const isActive = location.pathname === "/chat";

  return (
    <button
      type="button"
      onClick={() => navigate("/chat")}
      aria-current={isActive ? "page" : undefined}
      title="Community chatroom"
      className={`hidden sm:flex relative items-center gap-1.5 px-3 py-1.5 rounded-md border font-orbitron text-[10px] tracking-widest transition-colors ${
        isActive
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border/40 text-muted-foreground hover:text-primary hover:bg-primary/5 hover:border-primary/30"
      } ${className}`}
    >
      <MessagesSquare className="w-3.5 h-3.5" />
      CHAT
      {unread > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-background font-mono-share text-[8px] leading-[14px] text-center shadow-[0_0_6px_hsl(var(--primary)/0.6)]"
          aria-label={`${unread} unread`}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
};

export default DesktopChatLink;
