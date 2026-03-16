import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { saveChatMessage, getChatHistory, clearChatHistory, deleteChatMessage, type ChatMessage } from "@/lib/storage";
import { comfySubmitAndPollStandalone, comfyPollUntilDone } from "@/hooks/useGrokApi";
import CyberLayout from "@/components/CyberLayout";
import { ArrowLeft, Plus, Trash2, Send, Edit, X, MessageSquare, Sparkles, Image, Download, Paperclip } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PendingCharJob {
  characterId: string;
  promptId: string;
  outputType: "image" | "video";
  runpodEndpointId?: string;
  submittedAt: number;
}

const CHAR_JOBS_KEY = "char-media-jobs";

function getPendingCharJobs(): PendingCharJob[] {
  try { const raw = localStorage.getItem(CHAR_JOBS_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function savePendingCharJob(job: PendingCharJob) {
  const jobs = getPendingCharJobs().filter(j => j.promptId !== job.promptId);
  jobs.push(job);
  try { localStorage.setItem(CHAR_JOBS_KEY, JSON.stringify(jobs)); } catch {}
}
function removePendingCharJob(promptId: string) {
  const jobs = getPendingCharJobs().filter(j => j.promptId !== promptId);
  try { if (jobs.length) localStorage.setItem(CHAR_JOBS_KEY, JSON.stringify(jobs)); else localStorage.removeItem(CHAR_JOBS_KEY); } catch {}
}

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
  { value: "grok", label: "Grok (recommended)", cost: "1 cr/msg" },
  { value: "deepseek", label: "DeepSeek", cost: "1 cr/msg" },
];

/** Tiny component that ticks every second showing elapsed time */
function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [startTime]);
  return <span className="font-mono-share text-[9px] text-muted-foreground/50 tabular-nums">{elapsed}s</span>;
}

export default function Characters() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [view, setView] = useState<View>("gallery");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChar, setActiveChar] = useState<Character | null>(null);
  const [editingChar, setEditingChar] = useState<Character | null>(null);

  const [name, setName] = useState("");
  const [personality, setPersonality] = useState("");
  const [traits, setTraits] = useState<string[]>([]);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [llmBackend, setLlmBackend] = useState("grok");
  const [saving, setSaving] = useState(false);
  const portraitRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedMsgIdx, setSelectedMsgIdx] = useState<number | null>(null);

  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [lastUserImageBase64, setLastUserImageBase64] = useState<string | null>(null);
  const lastUserImageRef = useRef<string | null>(null);
  lastUserImageRef.current = lastUserImageBase64;
  const chatImageRef = useRef<HTMLInputElement>(null);

  // Keep a ref to activeChar so async callbacks always see the latest value
  const activeCharRef = useRef(activeChar);
  activeCharRef.current = activeChar;

  // ── Data fetching ──

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

  // ── Creator helpers ──

  const resetCreator = () => {
    setName(""); setPersonality(""); setTraits([]); setPortrait(null);
    setLlmBackend("grok"); setEditingChar(null);
  };

  const openCreator = (char?: Character) => {
    if (char) {
      setEditingChar(char);
      setName(char.name);
      setPersonality(char.personality);
      setTraits(char.traits || []);
      setPortrait(char.portrait_url);
      setLlmBackend(char.llm_backend || "grok");
    } else {
      resetCreator();
    }
    setView("creator");
  };

  const openChat = async (char: Character) => {
    setActiveChar(char);
    setLastUserImageBase64(null);
    setPendingImage(null);
    const history = await getChatHistory(char.id);
    setMessages(history);
    setView("chat");

    const pendingJobs = getPendingCharJobs().filter(j => j.characterId === char.id);
    for (const job of pendingJobs) {
      if (Date.now() - job.submittedAt > 15 * 60 * 1000) {
        removePendingCharJob(job.promptId);
        continue;
      }

      const pid = `resume-${job.promptId}`;
      const placeholder: ChatMessage = {
        characterId: char.id, role: "assistant",
        content: `*generating ${job.outputType}...*`, timestamp: Date.now(),
      };
      (placeholder as any)._pid = pid;
      setMessages(prev => [...prev, placeholder]);

      (async () => {
        try {
          const result = await comfyPollUntilDone(
            job.promptId, job.outputType,
            { runpodEndpointId: job.runpodEndpointId, pollInterval: 3000, maxAttempts: 200 },
          );
          removePendingCharJob(job.promptId);
          const mediaData = result.video || result.image;
          if (mediaData) {
            const mediaMsg: ChatMessage = {
              characterId: char.id, role: "assistant", content: "",
              mediaUrl: mediaData, mediaType: result.video ? "video" : "image", timestamp: Date.now(),
            };
            setMessages(prev => prev.map(m => (m as any)._pid === pid ? mediaMsg : m));
            await saveChatMessage(mediaMsg);
          } else {
            setMessages(prev => prev.map(m => (m as any)._pid === pid ? { ...m, content: "*media generation failed: no output*", _pid: undefined } as any : m));
          }
        } catch (err: any) {
          removePendingCharJob(job.promptId);
          setMessages(prev => prev.map(m => (m as any)._pid === pid ? { ...m, content: `*media generation failed: ${err.message}*`, _pid: undefined } as any : m));
        }
      })();
    }
  };

  const handlePortrait = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxDim = 512;
    const isHeic = (f: File) => {
      const t = (f.type || "").toLowerCase();
      const n = (f.name || "").toLowerCase();
      return t === "image/heic" || t === "image/heif" || n.endsWith(".heic") || n.endsWith(".heif");
    };
    try {
      let sourceBlob: Blob = file;
      if (isHeic(file)) {
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
        sourceBlob = Array.isArray(converted) ? converted[0] : converted;
      }
      const bitmap = await createImageBitmap(sourceBlob);
      let w = bitmap.width, h = bitmap.height;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      setPortrait(canvas.toDataURL("image/jpeg", 0.85));
    } catch {
      toast({ title: "Unsupported format", description: "Could not process image. Try JPG or PNG." });
    }
  };

  const handleChatImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let sourceBlob: Blob = file;
      const isHeic = (f: File) => {
        const t = (f.type || "").toLowerCase();
        const n = (f.name || "").toLowerCase();
        return t === "image/heic" || t === "image/heif" || n.endsWith(".heic") || n.endsWith(".heif");
      };
      if (isHeic(file)) {
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
        sourceBlob = Array.isArray(converted) ? converted[0] : converted;
      }
      const bitmap = await createImageBitmap(sourceBlob);
      const maxDim = 768;
      let w = bitmap.width, h = bitmap.height;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      setPendingImage(canvas.toDataURL("image/jpeg", 0.85));
    } catch {
      toast({ title: "Unsupported format", description: "Could not process image. Try JPG or PNG." });
    }
    e.target.value = "";
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

  const handleClearChat = async () => {
    if (!activeChar) return;
    await clearChatHistory(activeChar.id);
    try { await apiFetch("/characters", { method: "POST", body: { action: "reset-memory", characterId: activeChar.id } }); } catch { /* best effort */ }
    setMessages([]);
    setConfirmClear(false);
    toast({ title: "Cleared", description: "Chat history deleted" });
  };

  const handleDeleteMessage = async (idx: number) => {
    const msg = messages[idx];
    if (msg?.id) {
      await deleteChatMessage(msg.id);
    }
    setMessages(prev => prev.filter((_, i) => i !== idx));
    setSelectedMsgIdx(null);
  };

  const handleSaveMedia = (msg: ChatMessage) => {
    if (!msg.mediaUrl) return;
    const a = document.createElement("a");
    a.href = msg.mediaUrl;
    a.download = `character-${msg.mediaType || "media"}-${Date.now()}.${msg.mediaType === "video" ? "mp4" : "png"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setSelectedMsgIdx(null);
  };

  // ── Build history for API (avoids stale closure by accepting messages as arg) ──

  function buildHistoryForApi(msgs: ChatMessage[]) {
    return msgs
      .filter(m => !(m.content && /^\*(?:generating|animating)/.test(m.content)) && !m.content?.startsWith("*media generation failed"))
      .slice(-18)
      .map(m => ({
        role: m.role,
        content: m.imageBase64
          ? `[user sent a reference image] ${m.content || ""}`.trim()
          : m.content?.trim()
          ? m.content
          : m.mediaType === "video" ? "[attached video]"
          : m.mediaUrl ? "[attached image]"
          : "",
      }))
      .filter(m => m.content);
  }

  // ── Media generation (uses standalone comfySubmitAndPoll — no LoRAs, simple paths) ──

  const CAMERA_ANGLES: Record<string, string> = {
    closeup:   "close-up shot, ",
    wide:      "wide angle shot, ",
    topdown:   "top-down view, ",
    forward:   "camera moving forward, ",
    pov_down:  "looking down, ",
    left:      "camera from the left, ",
    right:     "camera from the right, ",
  };

  const handleMediaTrigger = useCallback(async (
    trigger: { type: "image" | "video"; prompt: string; videoLora?: string; videoLoraStrength?: number; cameraAngle?: string },
    char: Character,
  ) => {
    const placeholderId = `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const placeholderMsg: ChatMessage = {
      characterId: char.id, role: "assistant",
      content: `*generating ${trigger.type}...*`,
      timestamp: Date.now(),
    };
    // Tag placeholder with id via content so we can find it later
    (placeholderMsg as any)._pid = placeholderId;

    setMessages(prev => [...prev, { ...placeholderMsg }]);

    const replacePlaceholder = (msg: ChatMessage) =>
      setMessages(prev => prev.map(m => (m as any)._pid === placeholderId ? msg : m));
    const updatePlaceholder = (phase: string) =>
      setMessages(prev => prev.map(m => (m as any)._pid === placeholderId ? { ...m, content: `*${phase}*` } : m));
    const failPlaceholder = (errMsg: string) =>
      setMessages(prev => prev.map(m => (m as any)._pid === placeholderId ? { ...m, content: `*media generation failed: ${errMsg}*`, _pid: undefined } as any : m));

    try {
      const portrait64 = char.portrait_url;
      const hasPortrait = portrait64 && portrait64.length > 100;
      const refImage = lastUserImageRef.current;

      if (trigger.type === "image") {
        if (!hasPortrait) {
          failPlaceholder("Image generation requires a character portrait. Edit the character and add one.");
          return;
        }
        const anglePrefix = trigger.cameraAngle && CAMERA_ANGLES[trigger.cameraAngle] ? CAMERA_ANGLES[trigger.cameraAngle] : "";
        const imgBody: Record<string, any> = {
          workflow: "qwen-edit",
          prompt: anglePrefix + trigger.prompt,
          imageBase64: portrait64,
          imageFilename: "portrait.jpg",
          steps: 20, cfg: 5,
        };
        const result = await comfySubmitAndPollStandalone(imgBody);

        if (result.image) {
          const mediaMsg: ChatMessage = {
            characterId: char.id, role: "assistant", content: "",
            mediaUrl: result.image, mediaType: "image", timestamp: Date.now(),
          };
          replacePlaceholder(mediaMsg);
          await saveChatMessage(mediaMsg);
          return;
        }
        throw new Error("No image returned");
      }

      if (trigger.type === "video") {
        if (!hasPortrait) {
          failPlaceholder("Video requires a character portrait. Edit the character and add one.");
          return;
        }

        updatePlaceholder("generating image from portrait...");
        const vidAnglePrefix = trigger.cameraAngle && CAMERA_ANGLES[trigger.cameraAngle]
          ? CAMERA_ANGLES[trigger.cameraAngle]
          : CAMERA_ANGLES.closeup;
        const vidFrameBody: Record<string, any> = {
          workflow: "qwen-edit",
          prompt: vidAnglePrefix + trigger.prompt,
          imageBase64: portrait64,
          imageFilename: "portrait.jpg",
          steps: 20, cfg: 5,
        };
        const imgResult = await comfySubmitAndPollStandalone(vidFrameBody);

        if (!imgResult.image) throw new Error("Failed to generate source image for video");

        updatePlaceholder("animating video...");

        const submitData = await apiFetch<{ promptId: string; seed: number; outputType?: string; runpodEndpointId?: string }>(
          "/comfyui", {
            method: "POST",
            body: {
              action: "generate", workflow: "gltch-wan",
              prompt: trigger.prompt, imageBase64: imgResult.image, imageFilename: "character_frame.jpg",
              width: 832, height: 832, steps: 4, cfg: 1,
              frameCount: 81, shift: 8, useRife: true, useUpscale: false, resolution: 832,
              videoLora: trigger.videoLora || "mystic_xxx_wan22_i2v_v1",
              videoLoraStrength: trigger.videoLoraStrength || 0.09,
              videoLoraPass: "both",
            },
          },
        );

        savePendingCharJob({
          characterId: char.id,
          promptId: submitData.promptId,
          outputType: "video",
          runpodEndpointId: submitData.runpodEndpointId,
          submittedAt: Date.now(),
        });

        const videoResult = await comfyPollUntilDone(
          submitData.promptId,
          submitData.outputType || "video",
          { runpodEndpointId: submitData.runpodEndpointId, pollInterval: 3000, maxAttempts: 200 },
        );

        removePendingCharJob(submitData.promptId);

        const mediaData = videoResult.video || videoResult.image;
        if (mediaData) {
          const mediaMsg: ChatMessage = {
            characterId: char.id, role: "assistant", content: "",
            mediaUrl: mediaData, mediaType: videoResult.video ? "video" : "image", timestamp: Date.now(),
          };
          replacePlaceholder(mediaMsg);
          await saveChatMessage(mediaMsg);
          return;
        }
        throw new Error("No video returned");
      }

      failPlaceholder(`Unsupported media type: ${trigger.type}`);
    } catch (err: any) {
      failPlaceholder(err.message || "unknown error");
    }
  }, []);

  // ── Send message ──

  const sendMessage = async () => {
    if ((!chatInput.trim() && !pendingImage) || !activeChar || chatLoading) return;
    const text = chatInput.trim();
    const char = activeChar;
    const attachedImage = pendingImage;
    setChatInput("");
    setPendingImage(null);

    if (attachedImage) setLastUserImageBase64(attachedImage);

    const userMsg: ChatMessage = {
      characterId: char.id, role: "user", content: text || (attachedImage ? "" : ""), timestamp: Date.now(),
      imageBase64: attachedImage || undefined,
    };

    let historyForApi: { role: string; content: string }[] = [];
    setMessages(prev => {
      historyForApi = buildHistoryForApi(prev);
      return [...prev, userMsg];
    });
    await saveChatMessage(userMsg);

    setChatLoading(true);
    try {
      const apiBody: Record<string, any> = {
        action: "message", characterId: char.id, message: text || "[image]",
        history: historyForApi, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      if (attachedImage) apiBody.imageBase64 = attachedImage;

      const data = await apiFetch<{ reply: string; mediaTrigger?: { type: "image" | "video"; prompt: string; videoLora?: string; videoLoraStrength?: number; cameraAngle?: string } }>("/chat", {
        method: "POST",
        body: apiBody,
      });

      const assistantMsg: ChatMessage = {
        characterId: char.id, role: "assistant", content: data.reply, timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      await saveChatMessage(assistantMsg);

      if (data.mediaTrigger) {
        handleMediaTrigger(data.mediaTrigger, char);
      }
    } catch (err: any) {
      const errMsg: ChatMessage = {
        characterId: char.id, role: "assistant",
        content: `*${err.message || "Failed to respond"}*`, timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setChatLoading(false);
    }
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
                    className={`px-2.5 py-1 rounded-full font-mono-share text-[9px] border transition-all ${traits.includes(t)
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
                    className={`w-full flex items-center justify-between px-3 py-2 rounded border font-mono-share text-[10px] transition-all ${llmBackend === opt.value
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
                <p className="font-mono-share text-[8px] text-muted-foreground/60 capitalize">{activeChar.llm_backend === "deepseek" ? "grok" : activeChar.llm_backend} model</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 pb-3 min-h-0">
              {messages.length === 0 && (
                <div className="text-center py-10">
                  <p className="font-mono-share text-xs text-muted-foreground/50">Say hello to {activeChar.name}</p>
                </div>
              )}
              {messages.map((msg, i) => {
                const isGenerating = !!(msg.content && /^\*(?:generating|animating)/.test(msg.content) && msg.content.endsWith("*"));
                const genPhase = isGenerating ? msg.content!.replace(/^\*|\*$/g, "") : "";

                return (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} group relative`}>
                    <div
                      className={`max-w-[80%] px-3 py-2 rounded-lg cursor-pointer transition-all ${msg.role === "user"
                        ? "bg-secondary/20 border border-secondary/30 text-foreground"
                        : "bg-card/80 border border-border text-foreground"
                        } ${selectedMsgIdx === i ? "ring-1 ring-secondary/50" : ""}`}
                      onClick={() => setSelectedMsgIdx(selectedMsgIdx === i ? null : i)}
                    >
                      {/* Per-message action bar */}
                      {selectedMsgIdx === i && !isGenerating && (
                        <div className={`absolute ${msg.role === "user" ? "right-0" : "left-0"} -top-8 flex items-center gap-1 bg-card/95 border border-border rounded-md px-1.5 py-1 shadow-lg z-10 animate-in fade-in slide-in-from-bottom-1 duration-150`}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteMessage(i); }}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono-share text-red-400 hover:bg-red-500/20 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" /> DEL
                          </button>
                          {msg.mediaUrl && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSaveMedia(msg); }}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono-share text-secondary hover:bg-secondary/20 transition-colors"
                            >
                              <Download className="w-3 h-3" /> SAVE
                            </button>
                          )}
                        </div>
                      )}
                      {msg.imageBase64 && (
                        <img src={msg.imageBase64} alt="Reference" className="max-w-full rounded mb-2 max-h-48 object-contain border border-secondary/20" />
                      )}
                      {msg.mediaUrl && msg.mediaType === "image" && (
                        <img src={msg.mediaUrl} alt="From character" className="max-w-full rounded mb-2 max-h-64 object-contain" />
                      )}
                      {msg.mediaUrl && msg.mediaType === "video" && (
                        <video src={msg.mediaUrl} controls className="max-w-full rounded mb-2 max-h-64" />
                      )}
                      {isGenerating ? (
                        <div className="flex items-center gap-2 py-1">
                          <div className="relative w-5 h-5">
                            <div className="absolute inset-0 border-2 border-secondary/20 rounded-full" />
                            <div className="absolute inset-0 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
                          </div>
                          <span className="font-mono-share text-[10px] text-secondary/70 animate-pulse">{genPhase}</span>
                          <ElapsedTimer startTime={msg.timestamp} />
                        </div>
                      ) : msg.content ? (
                        <p className="font-mono-share text-[11px] leading-relaxed whitespace-pre-wrap">
                          {msg.content
                            .replace(/\[MEDIA_IMAGE\].*?\[\/MEDIA_IMAGE\]/gs, "")
                            .replace(/\[MEDIA_VIDEO\].*?\[\/MEDIA_VIDEO\]/gs, "")
                            .replace(/\[MEDIA_IMAGE\]/g, "")
                            .replace(/\[MEDIA_VIDEO\]/g, "")
                            .trim()}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
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

            {/* Pending image preview */}
            {pendingImage && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-card/40 border border-border rounded-t-lg shrink-0">
                <img src={pendingImage} alt="Attached" className="w-12 h-12 rounded object-cover border border-secondary/30" />
                <span className="font-mono-share text-[9px] text-muted-foreground flex-1">Reference image attached</span>
                <button onClick={() => setPendingImage(null)} className="p-1 hover:text-red-400 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Input */}
            <div className={`flex gap-2 shrink-0 ${pendingImage ? "-mt-px" : ""}`}>
              <input type="file" ref={chatImageRef} accept="image/*" className="hidden" onChange={handleChatImage} />
              <button onClick={() => chatImageRef.current?.click()} disabled={chatLoading}
                className="px-3 py-2.5 bg-card/60 border border-border rounded-lg hover:border-secondary/50 transition-colors disabled:opacity-50"
                title="Attach reference image">
                <Paperclip className="w-4 h-4 text-muted-foreground" />
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Message ${activeChar.name}...`}
                disabled={chatLoading}
                className="flex-1 bg-card/60 border border-border rounded-lg px-4 py-2.5 text-sm font-mono-share text-foreground placeholder-muted-foreground/40 disabled:opacity-50"
              />
              <button onClick={sendMessage} disabled={chatLoading || (!chatInput.trim() && !pendingImage)}
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
