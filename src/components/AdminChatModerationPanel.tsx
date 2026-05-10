/**
 * Admin chat moderation: view recent messages per channel, delete individual
 * messages, and ban users (per-channel or globally).
 */
import React, { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { Trash2, Ban, ShieldOff, RefreshCw, MessageSquare } from "lucide-react";

const CHANNELS = ["general", "help", "showcase", "nsfw"] as const;
type Channel = typeof CHANNELS[number];

interface Msg { id: string; channel: Channel; userId: string; username: string; text: string; ts: number; }
interface BanRow { user_id: string; username: string; channel: string; reason: string | null; until_ts: number | null; created_at: string; }

const AdminChatModerationPanel: React.FC = () => {
  const [channel, setChannel] = useState<Channel>("general");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banForm, setBanForm] = useState({ userId: "", channel: "*", hours: "24", reason: "" });

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ messages: Msg[] }>(`/chat?channel=${channel}`);
      setMessages((data?.messages || []).slice().reverse()); // newest first
    } catch (e: any) {
      toast.error(e?.message || "Failed to load messages");
    } finally { setLoading(false); }
  }, [channel]);

  const loadBans = useCallback(async () => {
    try {
      const data = await apiFetch<{ bans: BanRow[] }>(`/chat?action=bans`);
      setBans(data?.bans || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load bans");
    }
  }, []);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => { loadBans(); }, [loadBans]);

  const deleteMessage = async (id: string) => {
    if (!confirm("Delete this message?")) return;
    try {
      await apiFetch(`/chat?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessages((m) => m.filter((x) => x.id !== id));
      toast.success("Deleted");
    } catch (e: any) { toast.error(e?.message || "Delete failed"); }
  };

  const clearChannel = async () => {
    if (!confirm(`Clear ALL messages in #${channel}?`)) return;
    try {
      await apiFetch(`/chat?channel=${channel}`, { method: "DELETE" });
      setMessages([]);
      toast.success(`Cleared #${channel}`);
    } catch (e: any) { toast.error(e?.message || "Clear failed"); }
  };

  const banUser = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!banForm.userId.trim()) return toast.error("User ID required");
    try {
      await apiFetch(`/chat?action=ban`, {
        method: "POST",
        body: {
          userId: banForm.userId.trim(),
          channel: banForm.channel,
          hours: Number(banForm.hours) || 0,
          reason: banForm.reason.trim(),
        },
      });
      toast.success("User muted");
      setBanForm({ userId: "", channel: "*", hours: "24", reason: "" });
      loadBans();
    } catch (err: any) { toast.error(err?.message || "Ban failed"); }
  };

  const quickBan = (userId: string) => {
    setBanForm({ userId, channel, hours: "24", reason: "" });
    document.getElementById("chat-ban-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const unban = async (userId: string, ch: string) => {
    if (!confirm(`Unmute user from ${ch === "*" ? "all channels" : "#" + ch}?`)) return;
    try {
      await apiFetch(`/chat?action=unban`, { method: "POST", body: { userId, channel: ch } });
      toast.success("Unmuted");
      loadBans();
    } catch (e: any) { toast.error(e?.message || "Unban failed"); }
  };

  const fmtTime = (ts: number) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtUntil = (ts: number | null) => ts ? new Date(ts).toLocaleString() : "PERMANENT";

  return (
    <section className="border border-orange-500/30 rounded-lg bg-orange-950/10 backdrop-blur-sm overflow-hidden">
      <div className="px-3 sm:px-4 py-3 border-b border-orange-500/20 flex items-center justify-between">
        <h2 className="font-orbitron text-xs tracking-wider text-orange-400 flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5" />
          CHAT_MODERATION
        </h2>
        <button onClick={() => { loadMessages(); loadBans(); }} className="text-[10px] text-orange-400/70 hover:text-orange-300 flex items-center gap-1 font-mono-share">
          <RefreshCw className="w-3 h-3" /> REFRESH
        </button>
      </div>

      <div className="p-3 sm:p-4 space-y-4">
        {/* Channel picker */}
        <div className="flex items-center gap-2 flex-wrap">
          {CHANNELS.map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`px-3 py-1 text-[10px] font-mono-share uppercase tracking-wider rounded border ${
                channel === c
                  ? "border-orange-400 text-orange-300 bg-orange-500/10"
                  : "border-border/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              #{c}
            </button>
          ))}
          <div className="ml-auto">
            <button
              onClick={clearChannel}
              className="px-2 py-1 text-[10px] font-mono-share rounded bg-red-600/80 text-white hover:bg-red-500 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> CLEAR_CHANNEL
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="border border-border/30 rounded max-h-80 overflow-y-auto divide-y divide-border/20">
          {loading && <div className="p-4 text-center text-xs text-muted-foreground">Loading…</div>}
          {!loading && messages.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">No messages in #{channel}</div>
          )}
          {messages.map((m) => (
            <div key={m.id} className="px-3 py-2 flex items-start gap-2 hover:bg-muted/20">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-mono-share text-muted-foreground/70">
                  <span className="text-orange-300">{m.username}</span>
                  <span>·</span>
                  <span>{fmtTime(m.ts)}</span>
                  <span className="opacity-50 truncate">· {m.userId.slice(0, 8)}…</span>
                </div>
                <div className="text-xs text-foreground whitespace-pre-wrap break-words mt-0.5">{m.text}</div>
              </div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => deleteMessage(m.id)}
                  className="px-2 py-0.5 bg-red-600/80 text-white font-mono-share text-[9px] rounded hover:bg-red-500 flex items-center gap-1"
                >
                  <Trash2 className="w-2.5 h-2.5" /> DEL
                </button>
                <button
                  onClick={() => quickBan(m.userId)}
                  className="px-2 py-0.5 bg-orange-600/80 text-white font-mono-share text-[9px] rounded hover:bg-orange-500 flex items-center gap-1"
                >
                  <Ban className="w-2.5 h-2.5" /> BAN
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Ban form */}
        <form id="chat-ban-form" onSubmit={banUser} className="border border-orange-500/30 rounded p-3 space-y-2 bg-card/40">
          <div className="font-orbitron text-[10px] tracking-wider text-orange-300">MUTE_USER</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="User ID (UUID)"
              value={banForm.userId}
              onChange={(e) => setBanForm({ ...banForm, userId: e.target.value })}
              className="px-2 py-1.5 bg-background border border-border/50 rounded text-xs font-mono-share"
            />
            <select
              value={banForm.channel}
              onChange={(e) => setBanForm({ ...banForm, channel: e.target.value })}
              className="px-2 py-1.5 bg-background border border-border/50 rounded text-xs font-mono-share"
            >
              <option value="*">ALL CHANNELS (*)</option>
              {CHANNELS.map((c) => <option key={c} value={c}>#{c}</option>)}
            </select>
            <select
              value={banForm.hours}
              onChange={(e) => setBanForm({ ...banForm, hours: e.target.value })}
              className="px-2 py-1.5 bg-background border border-border/50 rounded text-xs font-mono-share"
            >
              <option value="1">1 HOUR</option>
              <option value="24">24 HOURS</option>
              <option value="168">7 DAYS</option>
              <option value="720">30 DAYS</option>
              <option value="0">PERMANENT</option>
            </select>
            <input
              type="text"
              placeholder="Reason (optional)"
              value={banForm.reason}
              onChange={(e) => setBanForm({ ...banForm, reason: e.target.value })}
              className="px-2 py-1.5 bg-background border border-border/50 rounded text-xs font-mono-share"
            />
          </div>
          <button type="submit" className="px-3 py-1.5 bg-orange-600 text-white font-mono-share text-[10px] rounded hover:bg-orange-500 flex items-center gap-1">
            <Ban className="w-3 h-3" /> APPLY_MUTE
          </button>
        </form>

        {/* Active bans */}
        <div>
          <div className="font-orbitron text-[10px] tracking-wider text-orange-300 mb-2">ACTIVE_MUTES ({bans.length})</div>
          {bans.length === 0 && (
            <div className="text-xs text-muted-foreground/60 font-mono-share">No active mutes.</div>
          )}
          {bans.length > 0 && (
            <div className="border border-border/30 rounded overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr className="font-mono-share text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-1.5 text-left">User</th>
                    <th className="px-2 py-1.5 text-left">Channel</th>
                    <th className="px-2 py-1.5 text-left">Reason</th>
                    <th className="px-2 py-1.5 text-left">Until</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {bans.map((b) => (
                    <tr key={`${b.user_id}-${b.channel}`}>
                      <td className="px-2 py-1.5 font-mono-share text-[10px]">
                        <div className="text-foreground">{b.username || "—"}</div>
                        <div className="text-muted-foreground/50">{b.user_id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-2 py-1.5 font-mono-share text-[10px] text-orange-300">{b.channel === "*" ? "ALL" : "#" + b.channel}</td>
                      <td className="px-2 py-1.5 text-[10px] text-muted-foreground">{b.reason || "—"}</td>
                      <td className="px-2 py-1.5 font-mono-share text-[10px] text-muted-foreground">{fmtUntil(b.until_ts ? Number(b.until_ts) : null)}</td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => unban(b.user_id, b.channel)}
                          className="px-2 py-0.5 bg-green-600/80 text-white font-mono-share text-[10px] rounded hover:bg-green-500 flex items-center gap-1"
                        >
                          <ShieldOff className="w-2.5 h-2.5" /> UNMUTE
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default AdminChatModerationPanel;
