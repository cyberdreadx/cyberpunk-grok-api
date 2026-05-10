/**
 * Lightweight chat room — topic channels, polling, ephemeral history.
 * Mounted as a fullscreen panel on /chat.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { apiFetch, hasAuthToken } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { setLastSeen } from "@/hooks/useChatUnread";
import { Send, Hash, RefreshCw, ArrowLeft } from "lucide-react";
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
  const { user } = useAuth();
  const authed = !!user && hasAuthToken();
  const [channel, setChannel] = useState<Channel>(() => {
    const s = typeof window !== "undefined" ? localStorage.getItem("chat-channel") : null;
    return (CHANNELS as readonly string[]).includes(s || "") ? (s as Channel) : "general";
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const lastTs = useRef(0);

  useEffect(() => {
    localStorage.setItem("chat-channel", channel);
    lastTs.current = 0;
    setMessages([]);
    setLoading(true);
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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    try {
      const res = await apiFetch<{ message: Msg }>(`/chat?channel=${channel}`, {
        method: "POST",
        body: { text: v },
      });
      if (res?.message) {
        setMessages((prev) => [...prev, res.message].slice(-100));
        lastTs.current = res.message.ts;
      }
      setText("");
    } catch (e: any) {
      toast.error(e?.message || "Failed to send");
    } finally {
      setSending(false);
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
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" /> back
            </button>
            <span className="text-xs uppercase tracking-[0.2em] text-primary/80">// chat</span>
          </div>
          <button
            onClick={() => { lastTs.current = 0; setMessages([]); poll(); }}
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            aria-label="Refresh"
          >
            <RefreshCw className="w-3 h-3" /> refresh
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
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {!authed && (
          <div className="text-center text-sm text-muted-foreground py-12">
            Sign in to join the chat.
          </div>
        )}
        {authed && loading && (
          <div className="text-center text-xs text-muted-foreground py-8">
            Connecting to #{channel}…
          </div>
        )}
        {authed && !loading && grouped.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-12">
            No messages yet in #{channel}. Say hi 👋
          </div>
        )}
        {grouped.map((m) => {
          const mine = user && m.userId === (user as any).id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm border ${
                mine
                  ? "bg-primary/10 border-primary/40 text-foreground"
                  : "bg-muted/30 border-border/60"
              }`}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-70 mb-0.5">
                  <span className={mine ? "text-primary" : "text-accent-foreground"}>{m.username}</span>
                  <span>·</span>
                  <span>{fmt(m.ts)}</span>
                </div>
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      {authed && (
        <div className="border-t border-border/60 bg-background/80 backdrop-blur px-3 py-2"
             style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
          <div className="flex gap-2 items-end">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={`Message #${channel}`}
              className="flex-1 resize-none bg-muted/20 border border-border/60 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary/60 max-h-32"
            />
            <button
              onClick={send}
              disabled={sending || !text.trim()}
              className="shrink-0 h-10 px-3 rounded-md bg-primary/15 border border-primary/50 text-primary hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-xs uppercase tracking-wider"
            >
              <Send className="w-3.5 h-3.5" /> send
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground/70 mt-1 text-right">
            {text.length}/500 · ephemeral · last 100 msgs
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatRoom;
