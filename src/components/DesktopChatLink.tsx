/**
 * Persistent CHAT / MSGS entries for desktop.
 *
 * Mobile has these in MobileBottomNav, but that nav is `sm:hidden`. On desktop
 * the only route to /chat was buried inside a hamburger drawer, so the chatroom
 * was effectively invisible; DMs would have had the same problem. These are the
 * desktop counterparts — same destinations, same unread badges, always on
 * screen. Hidden below `sm` so they never double up with the bottom nav.
 */
import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MessagesSquare, Mail } from "lucide-react";
import { useChatUnread } from "@/hooks/useChatUnread";
import { useDmUnread } from "@/hooks/useDmUnread";
import { useAuth } from "@/hooks/useAuth";

const NavPill: React.FC<{
  to: string;
  label: string;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  unread: number;
  className?: string;
}> = ({ to, label, title, Icon, unread, className = "" }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      aria-current={isActive ? "page" : undefined}
      title={title}
      className={`hidden sm:flex relative items-center gap-1.5 px-3 py-1.5 rounded-md border font-orbitron text-[10px] tracking-widest transition-colors ${
        isActive
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border/40 text-muted-foreground hover:text-primary hover:bg-primary/5 hover:border-primary/30"
      } ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
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

const DesktopChatLink: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { isAuthenticated } = useAuth();
  const { unread: chatUnread } = useChatUnread(!!isAuthenticated);

  if (!isAuthenticated) return null;
  return (
    <NavPill to="/chat" label="CHAT" title="Community chatroom"
             Icon={MessagesSquare} unread={chatUnread} className={className} />
  );
};

export const DesktopMessagesLink: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { isAuthenticated } = useAuth();
  const { unread: dmUnread } = useDmUnread(!!isAuthenticated);

  if (!isAuthenticated) return null;
  return (
    <NavPill to="/messages" label="MSGS" title="Direct messages"
             Icon={Mail} unread={dmUnread} className={className} />
  );
};

export default DesktopChatLink;
