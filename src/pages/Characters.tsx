import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { saveChatMessage, getChatHistory, clearChatHistory, type ChatMessage } from "@/lib/storage";
import CyberLayout from "@/components/CyberLayout";
import { ArrowLeft, Plus, Trash2, Send, Image, Film, Edit, X, MessageSquare, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Character {
  id: string;
  name: string;
  portrait_url: string | null;
  personality: string;
  traits: string[];
  system_prompt?: string;
  llm_backend: string;
  created_at: string;
  updated_at: string;
}

type View = "gallery" | "creator" | "chat";

const TRAIT_OPTIONS = [
  "flirty", "dominant", "submissive", "shy", "caring", "sarcastic",
  "playful", "mysterious", "romantic", "bold", "gentle", "wild",
  "intellectual", "seductive", "nurturing", "rebellious",
];

const LLM_OPTIONS = [
  { value: "deepseek", label: "DeepSeek (cheap, uncensored)", cost: "~0.1 cr/msg" },
  { value: "grok", label: "Grok (high quality)", cost: "~0.1 cr/msg" },
];

export default function Characters() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [view, setView] = useState<View>("gallery");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChar, setActiveChar] = useState<Character | null>(null);
  const [editingChar, setEditingChar] = useState<Character | null>(null);

  // Creator state
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState("");
  const [traits, setTraits] = useState<string[]>([]);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [llmBackend, setLlmBackend] = useState("deepseek");
  const [saving, setSaving] = useState(false);
  const portraitRef = useRef<HTMLInputElement>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchCharacters = useCallback(async () => {
    try {
      const data = await apiFetch<{ characters: Character[] }>("/characters", {
        method: "POST", body: { action: "list" },
      });
      setCharacters(data.characters || []);
    } catch {
      toast({ title: "Error", description: "Failed to load characters" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchCharacters(); }, [fetchCharacters]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const resetCreator = () => {
    setName(""); setPersonality(""); setTraits([]); setPortrait(null);
    setLlmBackend("deepseek"); setEditingChar(null);
  };

  const openCreator = (char?: Character) => {
    if (char) {
      setEditingChar(char);
      setName(char.name);
      setPersonality(char.personality);
      setTraits(char.traits || []);
      setPortrait(char.portrait_url);
      setLlmBackend(char.llm_backend || "deepseek");
    } else {
      resetCreator();
    }
    setView("creator");
  };

  const openChat = async (char: Character) => {
    setActiveChar(char);
    const history = await getChatHistory(char.id);
    setMessages(history);
    setView("chat");
  };

  const handlePortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const maxDim = 512;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const s = maxDim / Math.max(w, h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        setPortrait(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const toggleTrait = (t: string) => {
    setTraits(prev => prev.includes(t) ? prev.filter(x => x !== t) : prev.length < 10 ? [...prev, t] : prev);
  };

  const handleSave = async () => {
    if (!name.trim() || !personality.trim()) {
      toast({ title: "Missing fields", description: "Name and personality are required" });
      return;
    }
    setSaving(true);
    try {
      if (editingChar) {
        await apiFetch("/characters", {
          method: "POST",
          body: { action: "update", characterId: editingChar.id, name, personality, traits, portrait, llmBackend },
        });
        toast({ title: "Updated", description: `${name} has been updated` });
      } else {
        await apiFetch("/characters", {
          method: "POST",
          body: { action: "create", name, personality, traits, portrait, llmBackend },
        });
        toast({ title: "Created", description: `${name} is ready to chat` });
      }
      await fetchCharacters();
      resetCreator();
      setView("gallery");
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setConfirmDeleteId(null);
    try {
      await apiFetch("/characters", { method: "POST", body: { action: "delete", characterId: id } });
      await clearChatHistory(id);
      setCharacters(prev => prev.filter(c => c.id !== id));
      if (activeChar?.id === id) { setActiveChar(null); setView("gallery"); }
      toast({ title: "Deleted", description: "Character removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message });
    }
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || !activeChar || chatLoading) return;
    const text = chatInput.trim();
    setChatInput("");

    const userMsg: ChatMessage = {
      characterId: activeChar.id, role: "user", content: text, timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    await saveChatMessage(userMsg);

    setChatLoading(true);
    try {
      const historyForApi = messages.slice(-18).map(m => ({ role: m.role, content: m.content }));
      const data = await apiFetch<{ reply: string; mediaTrigger?: { type: "image" | "video"; prompt: string } }>("/chat", {
        method: "POST",
        body: { action: "message", characterId: activeChar.id, message: text, history: historyForApi },
      });

      const assistantMsg: ChatMessage = {
        characterId: activeChar.id, role: "assistant", content: data.reply, timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      await saveChatMessage(assistantMsg);

      if (data.mediaTrigger) {
        handleMediaTrigger(data.mediaTrigger);
      }
    } catch (err: any) {
      const errMsg: ChatMessage = {
        characterId: activeChar.id, role: "assistant",
        content: `*${err.message || "Failed to respond"}*`, timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  const submitAndPoll = async (body: Record<string, any>): Promise<{ image?: string; video?: string }> => {
    const submit = await apiFetch<{ promptId: string; runpodEndpointId?: string; outputType?: string }>("/comfyui", {
      method: "POST", body: { action: "generate", ...body },
    });
    const isVideo = body.workflow === "wan-video";
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await apiFetch<{ status: string; image?: string; video?: string; error?: string }>("/comfyui", {
        method: "POST",
        body: { action: "poll", promptId: submit.promptId, runpodEndpointId: submit.runpodEndpointId },
      });
      if (poll.status === "done") return { image: poll.image, video: poll.video };
      if (poll.status === "error") throw new Error(poll.error || "Generation failed");
    }
    throw new Error("Generation timed out");
  };

  const handleMediaTrigger = async (trigger: { type: "image" | "video"; prompt: string }) => {
    if (!activeChar) return;
    const placeholderMsg: ChatMessage = {
      characterId: activeChar.id, role: "assistant",
      content: `*generating ${trigger.type}...*`,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, placeholderMsg]);

    try {
      const portrait64 = activeChar.portrait_url;

      if (trigger.type === "image") {
        const hasPortrait = portrait64 && portrait64.length > 100;
        const result = hasPortrait
          ? await submitAndPoll({
              workflow: "qwen-edit",
              prompt: trigger.prompt,
              imageBase64: portrait64,
              imageFilename: "portrait.jpg",
              width: 832, height: 1216, steps: 8, cfg: 2.5,
            })
          : await submitAndPoll({
              workflow: "zimage",
              prompt: `${activeChar.name}. ${trigger.prompt}`,
              width: 832, height: 1216, steps: 8, cfg: 3.5,
            });
        if (result.image) {
          const mediaMsg: ChatMessage = {
            characterId: activeChar.id, role: "assistant", content: "",
            mediaUrl: result.image, mediaType: "image", timestamp: Date.now(),
          };
          setMessages(prev => prev.filter(m => m !== placeholderMsg).concat(mediaMsg));
          await saveChatMessage(mediaMsg);
          return;
        }
      }

      if (trigger.type === "video" && portrait64) {
        const result = await submitAndPoll({
          workflow: "wan-video",
          prompt: trigger.prompt,
          imageBase64: portrait64,
          imageFilename: "portrait.jpg",
          width: 832, height: 480, steps: 20,
        });
        if (result.video) {
          const mediaMsg: ChatMessage = {
            characterId: activeChar.id, role: "assistant", content: "",
            mediaUrl: result.video, mediaType: "video", timestamp: Date.now(),
          };
          setMessages(prev => prev.filter(m => m !== placeholderMsg).concat(mediaMsg));
          await saveChatMessage(mediaMsg);
          return;
        }
      }

      // Fallback for no portrait or unsupported type
      setMessages(prev => prev.map(m => m === placeholderMsg
        ? { ...m, content: `*[${trigger.type}] ${trigger.prompt}*` } : m));
    } catch (err: any) {
      setMessages(prev => prev.map(m => m === placeholderMsg
        ? { ...m, content: `*media generation failed: ${err.message || "unknown error"}*` } : m));
    }
  };

  const requestMedia = async (type: "image" | "video") => {
    if (!activeChar || chatLoading) return;
    const prompt = type === "image"
      ? `Send me a picture of yourself right now`
      : `Send me a short video of yourself`;
    setChatInput(prompt);
    // Auto-send
    const userMsg: ChatMessage = {
      characterId: activeChar.id, role: "user", content: prompt, timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    await saveChatMessage(userMsg);

    setChatLoading(true);
    try {
      const historyForApi = messages.slice(-18).map(m => ({ role: m.role, content: m.content }));
      const data = await apiFetch<{ reply: string; mediaTrigger?: { type: "image" | "video"; prompt: string } }>("/chat", {
        method: "POST",
        body: { action: "message", characterId: activeChar.id, message: prompt, history: historyForApi },
      });
      const assistantMsg: ChatMessage = {
        characterId: activeChar.id, role: "assistant", content: data.reply, timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      await saveChatMessage(assistantMsg);
      if (data.mediaTrigger) handleMediaTrigger(data.mediaTrigger);
    } catch (err: any) {
      const errMsg: ChatMessage = {
        characterId: activeChar.id, role: "assistant",
        content: `*${err.message || "Failed"}*`, timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setChatLoading(false);
      setChatInput("");
    }
  };

  const [confirmClear, setConfirmClear] = useState(false);
  const handleClearChat = async () => {
    if (!activeChar) return;
    await clearChatHistory(activeChar.id);
    setMessages([]);
    setConfirmClear(false);
    toast({ title: "Cleared", description: "Chat history deleted" });
  };

  // ── Render ──
  return (
    <CyberLayout>
      <div className="max-w-4xl mx-auto px-4 py-6 min-h-screen">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          {view !== "gallery" ? (
            <button onClick={() => { setView("gallery"); setActiveChar(null); resetCreator(); }}
              className="p-1.5 rounded bg-card/60 border border-border hover:border-secondary/50 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={() => navigate("/")}
              className="p-1.5 rounded bg-card/60 border border-border hover:border-secondary/50 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h1 className="font-orbitron text-lg tracking-wider text-foreground">
            {view === "gallery" ? "CHARACTERS" : view === "creator" ? (editingChar ? "EDIT CHARACTER" : "NEW CHARACTER") : activeChar?.name?.toUpperCase()}
          </h1>
          {view === "gallery" && (
            <button onClick={() => openCreator()}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-secondary/20 border border-secondary/40 rounded font-mono-share text-[10px] text-secondary hover:bg-secondary/30 transition-colors">
              <Plus className="w-3 h-3" /> NEW
            </button>
          )}
          {view === "chat" && (
            <div className="ml-auto flex items-center gap-2">
              {confirmClear ? (
                <div className="flex items-center gap-1.5 animate-in fade-in">
                  <span className="font-mono-share text-[9px] text-red-400">Delete all messages?</span>
                  <button onClick={handleClearChat}
                    className="px-2 py-1 bg-red-500/20 border border-red-500/50 rounded font-mono-share text-[9px] text-red-400 hover:bg-red-500/30 transition-colors">
                    YES
                  </button>
                  <button onClick={() => setConfirmClear(false)}
                    className="px-2 py-1 bg-card/60 border border-border rounded font-mono-share text-[9px] text-muted-foreground hover:text-foreground transition-colors">
                    NO
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmClear(true)}
                  className="p-1.5 bg-card/60 border border-border rounded hover:text-red-400 hover:border-red-400/30 transition-colors"
                  title="Clear chat history">
                  <Trash2 className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Gallery View ── */}
        {view === "gallery" && (
          <div className="space-y-4">
            {loading ? (
              <div className="text-center py-20 font-mono-share text-sm text-muted-foreground animate-pulse">Loading characters...</div>
            ) : characters.length === 0 ? (
              <div className="text-center py-20 space-y-4">
                <Sparkles className="w-12 h-12 mx-auto text-secondary/50" />
                <p className="font-mono-share text-sm text-muted-foreground">No characters yet</p>
                <button onClick={() => openCreator()}
                  className="px-4 py-2 bg-secondary/20 border border-secondary/40 rounded font-mono-share text-xs text-secondary hover:bg-secondary/30 transition-colors">
                  Create your first character
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {characters.map(c => (
                  <div key={c.id} className="group relative bg-card/60 border border-border rounded-lg overflow-hidden hover:border-secondary/40 transition-all cursor-pointer"
                    onClick={() => openChat(c)}>
                    {c.portrait_url ? (
                      <img src={c.portrait_url} alt={c.name} className="w-full aspect-[3/4] object-cover" />
                    ) : (
                      <div className="w-full aspect-[3/4] bg-gradient-to-br from-purple-900/30 to-cyan-900/30 flex items-center justify-center">
                        <MessageSquare className="w-10 h-10 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <h3 className="font-orbitron text-xs tracking-wider text-foreground truncate">{c.name}</h3>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(c.traits || []).slice(0, 3).map(t => (
                          <span key={t} className="px-1.5 py-0.5 bg-secondary/20 border border-secondary/30 rounded-full font-mono-share text-[7px] text-secondary/80">
                            {t}
                          </span>
                        ))}
                      </div>
                      <p className="font-mono-share text-[8px] text-muted-foreground/60 mt-1 capitalize">{c.llm_backend}</p>
                    </div>
                    {/* Action buttons on hover */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {confirmDeleteId === c.id ? (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                            className="px-2 py-1 bg-red-500/30 rounded border border-red-500/50 font-mono-share text-[9px] text-red-400 hover:bg-red-500/40 transition-colors">
                            DELETE
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            className="px-2 py-1 bg-black/70 rounded border border-border font-mono-share text-[9px] text-muted-foreground hover:text-foreground transition-colors">
                            CANCEL
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); openCreator(c); }}
                            className="p-1.5 bg-black/70 rounded border border-border hover:border-purple-400/50 transition-colors">
                            <Edit className="w-3 h-3 text-purple-400" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                            className="p-1.5 bg-black/70 rounded border border-border hover:border-red-400/50 transition-colors">
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Creator View ── */}
        {view === "creator" && (
          <div className="space-y-4 max-w-lg mx-auto">
            {/* Portrait */}
            <div className="text-center">
              {portrait ? (
                <div className="relative inline-block">
                  <img src={portrait} alt="Portrait" className="w-32 h-32 rounded-full object-cover border-2 border-secondary/40" />
                  <button onClick={() => setPortrait(null)}
                    className="absolute -top-1 -right-1 p-1 bg-black/80 rounded-full border border-red-400/50">
                    <X className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ) : (
                <button onClick={() => portraitRef.current?.click()}
                  className="w-32 h-32 mx-auto rounded-full border-2 border-dashed border-border hover:border-secondary/40 flex flex-col items-center justify-center gap-1 transition-colors">
                  <Image className="w-6 h-6 text-muted-foreground/40" />
                  <span className="font-mono-share text-[8px] text-muted-foreground/40">PORTRAIT</span>
                </button>
              )}
              <input ref={portraitRef} type="file" accept="image/*" onChange={handlePortrait} className="hidden" />
            </div>

            {/* Name */}
            <div>
              <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">NAME</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={100}
                placeholder="e.g. Luna, Kai, Sasha..."
                className="w-full bg-card/60 border border-border rounded px-3 py-2 text-sm font-mono-share text-foreground placeholder-muted-foreground/40" />
            </div>

            {/* Personality */}
            <div>
              <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">PERSONALITY</label>
              <textarea value={personality} onChange={e => setPersonality(e.target.value)} maxLength={2000} rows={4}
                placeholder="Describe their personality, backstory, how they talk..."
                className="w-full bg-card/60 border border-border rounded px-3 py-2 text-sm font-mono-share text-foreground placeholder-muted-foreground/40 resize-none" />
            </div>

            {/* Traits */}
            <div>
              <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">TRAITS</label>
              <div className="flex flex-wrap gap-1.5">
                {TRAIT_OPTIONS.map(t => (
                  <button key={t} onClick={() => toggleTrait(t)}
                    className={`px-2.5 py-1 rounded-full font-mono-share text-[9px] border transition-all ${
                      traits.includes(t)
                        ? "bg-secondary/20 border-secondary/50 text-secondary"
                        : "bg-card/40 border-border text-muted-foreground/60 hover:border-muted-foreground/40"
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* LLM Backend */}
            <div>
              <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">AI MODEL</label>
              <div className="space-y-1.5">
                {LLM_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setLlmBackend(opt.value)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded border font-mono-share text-[10px] transition-all ${
                      llmBackend === opt.value
                        ? "border-secondary/50 bg-secondary/10 text-foreground"
                        : "border-border bg-card/40 text-muted-foreground hover:border-muted-foreground/40"
                    }`}>
                    <span>{opt.label}</span>
                    <span className="text-muted-foreground/50">{opt.cost}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Save */}
            <button onClick={handleSave} disabled={saving || !name.trim() || !personality.trim()}
              className="w-full py-3 bg-secondary/30 border border-secondary/50 rounded font-orbitron text-xs tracking-wider text-secondary hover:bg-secondary/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "SAVING..." : editingChar ? "UPDATE CHARACTER" : "CREATE CHARACTER"}
            </button>
          </div>
        )}

        {/* ── Chat View ── */}
        {view === "chat" && activeChar && (
          <div className="flex flex-col" style={{ height: "calc(100vh - 140px)" }}>
            {/* Character header */}
            <div className="flex items-center gap-3 pb-3 border-b border-border mb-3 shrink-0">
              {activeChar.portrait_url ? (
                <img src={activeChar.portrait_url} alt={activeChar.name} className="w-10 h-10 rounded-full object-cover border border-secondary/30" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-secondary/50" />
                </div>
              )}
              <div>
                <h3 className="font-orbitron text-xs tracking-wider">{activeChar.name}</h3>
                <p className="font-mono-share text-[8px] text-muted-foreground/60 capitalize">{activeChar.llm_backend} model</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 pb-3 min-h-0">
              {messages.length === 0 && (
                <div className="text-center py-10">
                  <p className="font-mono-share text-xs text-muted-foreground/50">Say hello to {activeChar.name}</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-lg ${
                    msg.role === "user"
                      ? "bg-secondary/20 border border-secondary/30 text-foreground"
                      : "bg-card/80 border border-border text-foreground"
                  }`}>
                    {msg.mediaUrl && msg.mediaType === "image" && (
                      <img src={msg.mediaUrl} alt="From character" className="max-w-full rounded mb-2 max-h-64 object-contain" />
                    )}
                    {msg.mediaUrl && msg.mediaType === "video" && (
                      <video src={msg.mediaUrl} controls className="max-w-full rounded mb-2 max-h-64" />
                    )}
                    {msg.content && (
                      <p className="font-mono-share text-[11px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-card/80 border border-border px-4 py-2 rounded-lg">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Media request buttons */}
            <div className="flex gap-2 pb-2 shrink-0">
              <button onClick={() => requestMedia("image")} disabled={chatLoading}
                className="flex items-center gap-1 px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded font-mono-share text-[9px] text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50">
                <Image className="w-3 h-3" /> Send pic
              </button>
              <button onClick={() => requestMedia("video")} disabled={chatLoading}
                className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded font-mono-share text-[9px] text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-50">
                <Film className="w-3 h-3" /> Send video
              </button>
            </div>

            {/* Input */}
            <div className="flex gap-2 shrink-0">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Message ${activeChar.name}...`}
                disabled={chatLoading}
                className="flex-1 bg-card/60 border border-border rounded-lg px-4 py-2.5 text-sm font-mono-share text-foreground placeholder-muted-foreground/40 disabled:opacity-50"
              />
              <button onClick={sendMessage} disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2.5 bg-secondary/30 border border-secondary/50 rounded-lg hover:bg-secondary/40 transition-colors disabled:opacity-50">
                <Send className="w-4 h-4 text-secondary" />
              </button>
            </div>
          </div>
        )}
      </div>
    </CyberLayout>
  );
}
