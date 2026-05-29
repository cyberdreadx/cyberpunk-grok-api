/**
 * Lightweight chat room — topic channels, polling, ephemeral history.
 * Mounted as a fullscreen panel on /chat.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { apiFetch, hasAuthToken } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { setLastSeen } from "@/hooks/useChatUnread";
import { Send, Hash, RefreshCw, ArrowLeft, Reply, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const CHANNELS = ["general", "help", "showcase", "nsfw"] as const;
type Channel = typeof CHANNELS[number];

interface Msg {
  id: string;
  channel: Channel;
  userId: string;
  username: string;
  text: string;
  ts: number;
}

const POLL_MS = 3500;

const ChatRoom: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const authed = !!user && hasAuthToken();
  const [channel, setChannel] = useState<Channel>(() => {
    const s = typeof window !== "undefined" ? localStorage.getItem("chat-channel") : null;
    return (CHANNELS as readonly string[]).includes(s || "") ? (s as Channel) : "general";
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastTs = useRef(0);
  const isInitialLoad = useRef(true);
  const stickToBottom = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    localStorage.setItem("chat-channel", channel);
    lastTs.current = 0;
    setMessages([]);
    setLoading(true);
    setReplyTo(null);
    isInitialLoad.current = true;
    stickToBottom.current = true;
  }, [channel]);

  const poll = useCallback(async () => {
    if (!authed) return;
    try {
      const data = await apiFetch<{ messages: Msg[] }>(
        `/chat?channel=${channel}${lastTs.current ? `&since=${lastTs.current}` : ""}`
      );
      if (!data?.messages) return;
      if (lastTs.current === 0) {
        setMessages(data.messages);
      } else if (data.messages.length) {
        setMessages((prev) => {
          const merged = [...prev, ...data.messages];
          return merged.slice(-100);
        });
      }
      if (data.messages.length) {
        lastTs.current = data.messages[data.messages.length - 1].ts;
        setLastSeen(channel, lastTs.current);
      } else if (lastTs.current === 0) {
        lastTs.current = Date.now();
        setLastSeen(channel, lastTs.current);
      }
    } catch (e) {
      // silent — polling will retry
    } finally {
      setLoading(false);
    }
  }, [authed, channel]);

  useEffect(() => {
    if (!authed) { setLoading(false); return; }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll, authed]);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // Jump to latest on open / channel switch; stick when user is near bottom
  useEffect(() => {
    if (messages.length === 0) return;
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      requestAnimationFrame(() => scrollToBottom("auto"));
      return;
    }
    if (stickToBottom.current) scrollToBottom("auto");
  }, [messages, scrollToBottom]);

  const startReply = useCallback((username: string) => {
    if (!username) return;
    setReplyTo(username);
    const mention = `@${username} `;
    setText((prev) => (prev.startsWith(mention) ? prev : prev.trim() ? `${mention}${prev}` : mention));
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const send = async () => {
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    const mentionsBot = /(^|\s)@gltch\b/i.test(v);
    try {
      const res = await apiFetch<{ message: Msg; botMessage?: Msg }>(`/chat?channel=${channel}`, {
        method: "POST",
        body: { text: v },
      });
      if (res?.message) {
        stickToBottom.current = true;
        setMessages((prev) => {
          const next = [...prev, res.message];
          if (res.botMessage) next.push(res.botMessage);
          return next.slice(-100);
        });
        lastTs.current = (res.botMessage?.ts || res.message.ts);
      }
      setText("");
      setReplyTo(null);
    } catch (e: any) {
      toast.error(e?.message || t("chat.failedSend"));
    } finally {
      setSending(false);
      if (mentionsBot) {
        // ensure poll picks up bot message even if response omitted it
        setTimeout(() => poll(), 600);
      }
    }
  };

  const fmt = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const grouped = useMemo(() => messages, [messages]);

  return (
    <div className="flex flex-col h-[100dvh] bg-background text-foreground"
         style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header / channels */}
      <div className="border-b border-border/60 backdrop-blur sticky top-0 z-10 bg-background/80">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { if (window.history.length > 1) navigate(-1); else navigate("/"); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary -ml-1 pr-2 py-1"
              aria-label={t("chat.back")}
            >
              <ArrowLeft className="w-4 h-4" /> {t("chat.back")}
            </button>
            <span className="text-xs uppercase tracking-[0.2em] text-primary/80">{t("chat.title")}</span>
          </div>
          <button
            onClick={() => {
              lastTs.current = 0;
              setMessages([]);
              isInitialLoad.current = true;
              stickToBottom.current = true;
              poll();
            }}
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            aria-label={t("chat.refresh")}
          >
            <RefreshCw className="w-3 h-3" /> {t("chat.refresh")}
          </button>
        </div>
        <div className="flex gap-1 px-2 pb-2 overflow-x-auto no-scrollbar">
          {CHANNELS.map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border transition flex items-center gap-1 ${
                channel === c
                  ? "border-primary text-primary bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.3)]"
                  : "border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Hash className="w-3 h-3" />{c}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} onScroll={onListScroll} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {!authed && (
          <div className="text-center text-sm text-muted-foreground py-12">
            {t("chat.signInPrompt")}
          </div>
        )}
        {authed && loading && (
          <div className="text-center text-xs text-muted-foreground py-8">
            {t("chat.connecting", { channel })}
          </div>
        )}
        {authed && !loading && grouped.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-12">
            {t("chat.empty", { channel })}
          </div>
        )}
        {grouped.map((m) => {
          const mine = user && m.userId === (user as any).id;
          const isBot = m.username === "gltch" && m.userId?.startsWith("00000000-0000-0000-0000-0000000067c4");
          const promptMatch = isBot ? m.text.match(/⟦prompt⟧([\s\S]+?)⟦\/prompt⟧/) : null;
          const cleanText = promptMatch ? m.text.replace(promptMatch[0], "").trim() : m.text;
          return (
            <div key={m.id} className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm border ${
                isBot
                  ? "bg-accent/10 border-accent/50 text-foreground shadow-[0_0_12px_hsl(var(--accent)/0.25)]"
                  : mine
                    ? "bg-primary/10 border-primary/40 text-foreground"
                    : "bg-muted/30 border-border/60"
              }`}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80 mb-0.5">
                  {isBot ? (
                    <span className="text-accent font-bold">◆ {m.username} <span className="opacity-60">/ai</span></span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (m.username) navigate(`/profile/${encodeURIComponent(m.username)}`);
                        }}
                        className={`hover:underline focus:underline focus:outline-none ${mine ? "text-primary" : "text-accent-foreground"}`}
                        aria-label={`Open profile ${m.username}`}
                      >
                        {m.username}
                      </button>
                      {!mine && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); startReply(m.username); }}
                          className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 inline-flex items-center gap-0.5 text-primary/80 hover:text-primary transition-opacity normal-case tracking-normal"
                          aria-label={t("chat.replyTo", { username: m.username })}
                        >
                          <Reply className="w-3 h-3" />
                          {t("chat.reply")}
                        </button>
                      )}
                    </>
                  )}
                  <span className="ml-auto shrink-0">· {fmt(m.ts)}</span>
                </div>
                <div className="whitespace-pre-wrap break-words">{cleanText}</div>
                {promptMatch && (
                  <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-primary/80 mb-1">prompt</div>
                    <div className="text-xs italic text-foreground/90 mb-2 whitespace-pre-wrap break-words">{promptMatch[1].trim()}</div>
                    <button
                      onClick={() => navigate(`/create?prompt=${encodeURIComponent(promptMatch[1].trim())}`)}
                      className="text-[11px] uppercase tracking-wider px-2 py-1 rounded border border-primary/60 text-primary bg-primary/10 hover:bg-primary/20"
                    >
                      ▶ Use prompt
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      {authed && (
        <div className="border-t border-border/60 bg-background/80 backdrop-blur px-3 py-2"
             style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
          {replyTo && (
            <div className="flex items-center gap-2 mb-2 px-2 py-1 rounded border border-primary/30 bg-primary/5 text-[11px]">
              <Reply className="w-3 h-3 text-primary shrink-0" />
              <span className="text-muted-foreground">{t("chat.replyingTo")}</span>
              <span className="text-primary font-medium">@{replyTo}</span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="ml-auto p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={t("chat.cancelReply")}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={composerRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={t("chat.placeholder", { channel })}
              className="flex-1 resize-none bg-muted/20 border border-border/60 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary/60 max-h-32"
            />
            <button
              onClick={send}
              disabled={sending || !text.trim()}
              className="shrink-0 h-10 px-3 rounded-md bg-primary/15 border border-primary/50 text-primary hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-xs uppercase tracking-wider"
            >
              <Send className="w-3.5 h-3.5" /> {t("chat.send")}
            </button>
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="text-[10px] text-accent/70">tip: type <span className="text-accent font-bold">@gltch</span> for AI help</div>
            <div className="text-[10px] text-muted-foreground/70">
              {t("chat.footer", { count: text.length })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatRoom;
