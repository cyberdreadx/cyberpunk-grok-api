/**
 * Direct messages — thread list + conversation view.
 *
 * Polling is deliberately asymmetric, because DM polling is per-user (unlike
 * the shared public chatroom, which is one channel for everyone):
 *   - thread list      : refreshed on open, on focus, and every 30s
 *   - open conversation: every 4s
 *   - both PAUSE when the tab is hidden
 *   - the unread badge costs nothing extra — it rides on /api/pulse
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, MessageSquare, Ban, RefreshCw } from "lucide-react";
import { apiFetch, hasAuthToken } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { refreshPulse } from "@/hooks/usePulse";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const THREAD_POLL_MS = 30_000;
const MESSAGE_POLL_MS = 4_000;

interface Thread {
  id: string;
  otherId: string;
  otherUsername: string;
  otherAvatarUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  lastSenderId: string | null;
  unread: number;
}

interface DmMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
  mine: boolean;
}

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Render message text with http(s) URLs as clickable links. */
function renderWithLinks(text: string): React.ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (!/^https?:\/\//.test(part)) return part;
    const url = part.replace(/[.,!?;:]+$/, "");
    const rest = part.slice(url.length);
    return (
      <React.Fragment key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer"
           className="underline text-primary hover:text-primary/80 break-all">{url}</a>
        {rest}
      </React.Fragment>
    );
  });
}

const DirectMessages: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const authed = !!user && hasAuthToken();
  const [params, setParams] = useSearchParams();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(params.get("thread"));
  /**
   * Arriving from a profile's MESSAGE button: ?to=<userId>&u=<username>.
   * If a thread with that user already exists we jump straight to it; if not we
   * show an empty conversation, and the first send creates the thread server-side.
   */
  const composeTo = params.get("to");
  const composeUsername = params.get("u") || "user";
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const listRef = useRef<HTMLDivElement>(null);
  const lastAt = useRef<string | null>(null);
  const stickToBottom = useRef(true);

  // A "pending" thread stands in for a conversation that doesn't exist yet, so
  // the composer has someone to send to before the first message is written.
  const existingForCompose = composeTo ? threads.find((t) => t.otherId === composeTo) : undefined;
  const pending: Thread | null =
    composeTo && !existingForCompose
      ? {
          id: "pending",
          otherId: composeTo,
          otherUsername: composeUsername,
          otherAvatarUrl: null,
          lastMessage: null,
          lastMessageAt: "",
          lastSenderId: null,
          unread: 0,
        }
      : null;

  const active =
    threads.find((t) => t.id === activeId) || (activeId === "pending" ? pending : null) || null;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  /* ── Thread list ─────────────────────────────────────────────────── */
  const loadThreads = useCallback(async () => {
    if (!authed) return;
    try {
      const data = await apiFetch<{ threads: Thread[] }>("/dm");
      setThreads(data?.threads || []);
    } catch {
      /* silent — next poll retries */
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    if (!authed) { setLoading(false); return; }
    loadThreads();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadThreads();
    }, THREAD_POLL_MS);
    const onFocus = () => loadThreads();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [authed, loadThreads]);

  /* ── Open conversation ───────────────────────────────────────────── */
  // Resolve ?to= into an open conversation once threads have loaded.
  useEffect(() => {
    if (!composeTo || activeId) return;
    setActiveId(existingForCompose ? existingForCompose.id : "pending");
  }, [composeTo, activeId, existingForCompose]);

  useEffect(() => {
    lastAt.current = null;
    setMessages([]);
    stickToBottom.current = true;
    // Keep ?to=/?u= in the URL while composing — they're what defines the
    // pending thread, and dropping them would strip the recipient mid-typing.
    if (activeId && activeId !== "pending") setParams({ thread: activeId }, { replace: true });
  }, [activeId, setParams]);

  const pollMessages = useCallback(async () => {
    // "pending" has no server-side thread yet — nothing to fetch.
    if (!authed || !activeId || activeId === "pending") return;
    try {
      const qs = lastAt.current ? `&since=${encodeURIComponent(lastAt.current)}` : "";
      const data = await apiFetch<{ messages: DmMessage[] }>(`/dm?threadId=${activeId}${qs}`);
      if (!data?.messages) return;
      if (lastAt.current === null) {
        setMessages(data.messages);
      } else if (data.messages.length) {
        // Merge by id, never blind-append. The server cursor is exclusive, but
        // it used to lose microseconds through JSON (Postgres stores .023267,
        // a JS Date holds .023) so `created_at > since` matched the very row
        // the cursor pointed at and every poll re-sent the newest message —
        // which the UI then showed again, and again. The wire format is fixed;
        // this makes any future cursor drift a no-op instead of a duplicate.
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = data.messages.filter((m) => !seen.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      }
      if (data.messages.length) {
        lastAt.current = data.messages[data.messages.length - 1].createdAt;
      }
    } catch {
      /* silent */
    }
  }, [authed, activeId]);

  useEffect(() => {
    if (!activeId || activeId === "pending") return;
    pollMessages();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") pollMessages();
    }, MESSAGE_POLL_MS);
    return () => clearInterval(id);
  }, [activeId, pollMessages]);

  // Mark read when a thread is opened or new messages land in it.
  useEffect(() => {
    if (!activeId || activeId === "pending" || !active || active.unread === 0) return;
    apiFetch("/dm?action=read", { method: "POST", body: { threadId: activeId } })
      .then(() => {
        setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, unread: 0 } : t)));
        refreshPulse();
      })
      .catch(() => {});
  }, [activeId, active]);

  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  /* ── Send ────────────────────────────────────────────────────────── */
  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || !active || sending) return;
    setSending(true);
    try {
      const data = await apiFetch<{ threadId: string; message: DmMessage }>("/dm", {
        method: "POST",
        body: { toUserId: active.otherId, text: body },
      });
      setText("");
      if (data?.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
        );
        lastAt.current = data.message.createdAt;
      }
      stickToBottom.current = true;
      // First message on a pending thread: adopt the real id the server made.
      if (activeId === "pending" && data?.threadId) setActiveId(data.threadId);
      loadThreads();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't send");
    } finally {
      setSending(false);
    }
  }, [text, active, sending, loadThreads, activeId]);

  /** Back out of a conversation, clearing any pending-compose params. */
  const closeThread = useCallback(() => {
    setActiveId(null);
    setParams({}, { replace: true });
  }, [setParams]);

  const blockUser = useCallback(async () => {
    if (!active) return;
    if (!window.confirm(`Block @${active.otherUsername}? Neither of you will be able to message the other.`)) return;
    try {
      await apiFetch("/blocks", { method: "POST", body: { userId: active.otherId } });
      toast.success(`Blocked @${active.otherUsername}`);
      closeThread();
      loadThreads();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't block");
    }
  }, [active, loadThreads]);

  if (!authed) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6">
        <p className="font-mono-share text-sm text-muted-foreground">Sign in to use messages.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/90 backdrop-blur-md border-b border-border/30 px-3 py-2"
           style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (activeId ? closeThread() : navigate("/"))}
            className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors"
            aria-label={activeId ? "Back to conversations" : "Back"}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-orbitron text-[11px] tracking-widest text-primary flex-1 truncate">
            {active ? `@${active.otherUsername}` : "MESSAGES"}
          </span>
          {active ? (
            <button type="button" onClick={blockUser}
                    className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                    title="Block this user">
              <Ban className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" onClick={loadThreads}
                    className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors"
                    title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Thread list */}
      {!activeId && (
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center font-mono-share text-[11px] text-muted-foreground/60">loading…</div>
          ) : threads.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <MessageSquare className="w-6 h-6 mx-auto text-muted-foreground/30" />
              <p className="font-mono-share text-[11px] text-muted-foreground/60">
                No conversations yet.
              </p>
              <p className="font-mono-share text-[10px] text-muted-foreground/40">
                Open someone's profile and hit MESSAGE to start one.
              </p>
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                className="w-full flex items-center gap-3 px-3 py-3 border-b border-border/20 hover:bg-primary/5 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-full bg-card border border-border/50 overflow-hidden shrink-0">
                  {t.otherAvatarUrl && (
                    <img src={t.otherAvatarUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-orbitron text-[11px] tracking-wider text-foreground truncate">
                      @{t.otherUsername}
                    </span>
                    <span className="font-mono-share text-[9px] text-muted-foreground/50 shrink-0">
                      {t.lastMessageAt ? formatDistanceToNow(new Date(t.lastMessageAt), { addSuffix: true }) : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono-share text-[10px] truncate ${t.unread > 0 ? "text-foreground/80" : "text-muted-foreground/50"}`}>
                      {t.lastSenderId && t.lastSenderId !== t.otherId ? "You: " : ""}{t.lastMessage || "…"}
                    </span>
                    {t.unread > 0 && (
                      <span className="shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-primary text-background font-mono-share text-[9px] leading-4 text-center">
                        {t.unread > 9 ? "9+" : t.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Conversation */}
      {activeId && (
        <>
          <div ref={listRef} onScroll={onListScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[78%] px-3 py-2 rounded-lg font-mono-share text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
                    m.mine
                      ? "bg-primary/15 border border-primary/30 text-foreground"
                      : "bg-card border border-border/50 text-foreground/90"
                  }`}
                >
                  {renderWithLinks(m.text)}
                  <div className="mt-1 font-mono-share text-[8px] text-muted-foreground/40">
                    {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-md border-t border-border/30 px-3 py-2"
               style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 2000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                rows={1}
                placeholder="Message…"
                className="flex-1 resize-none bg-card/60 border border-border/50 rounded px-3 py-2 font-mono-share text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 max-h-32"
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !text.trim()}
                className="p-2 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                aria-label="Send"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DirectMessages;
