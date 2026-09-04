/**
 * Easy mode — a chat thread over the same generate APIs Classic uses.
 *
 * Nothing here is a new backend. Every send routes to one of the functions
 * already on useGrokApi, with the same defaults Classic passes:
 *
 *   text only              -> comfyGenerate({ workflow: "zimage" })   3 cr
 *   text + image           -> comfyEdit(...)                          3 cr
 *   text + image, "video"  -> comfyVideo({ workflow: "gltch-wan" })  15 cr
 *
 * zimage is the text-to-image default rather than txt2img because txt2img
 * requires a checkpoint the user would have to pick — Easy has to work with
 * zero options open.
 *
 * A bubble is bound to its job by the id the generate call now returns, and
 * claims the results that appear at the head of `results` while that job runs.
 * Classic is untouched by any of this.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Loader2, MessageSquarePlus, Menu, Paperclip, Pencil, RefreshCw, Sliders, Sparkles, Square, Trash2, Video, Wand2, X } from "lucide-react";
import { getImageDimensions, type ComfyJob, type GrokResult } from "@/hooks/useGrokApi";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { getAssist, setAssist } from "@/lib/createMode";
import { useEasyThreads, type StoredMessage } from "@/hooks/useEasyThreads";
import { uploadPublicMedia } from "@/lib/mediaUpload";

/** Only the fields Easy actually sends. The hook's own parameter types are
 *  wider; narrowing here keeps this file honest about what it uses. */
interface GenerateArgs {
  prompt: string;
  workflow?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
}
interface EditArgs extends GenerateArgs {
  imageBase64: string;
}
interface VideoArgs extends EditArgs {
  frameCount?: number;
  resolution?: number;
  shift?: number;
  useRife?: boolean;
  useUpscale?: boolean;
}

export interface EasyEngines {
  comfyGenerate: (p: GenerateArgs) => string | undefined;
  comfyEdit: (p: EditArgs) => string | undefined;
  comfyVideo: (p: VideoArgs) => string | undefined;
  /** LTX — the sharper engine, and the only one with sound. */
  ltxVideo: (p: {
    prompt: string;
    imageBase64?: string;
    imageFilename?: string;
    width?: number;
    height?: number;
    frameCount?: number;
    frameRate?: number;
    audio?: boolean;
  }) => string | undefined;
  results: GrokResult[];
  comfyJobs: ComfyJob[];
  /** Classic's own handlers, reused verbatim for "Open in Classic". */
  onEditImage: (url: string) => void;
  onAnimateImage: (url: string) => void;
  /** Classic already offers this on a running job; Easy had no way to stop one. */
  cancelComfyJob: (jobId: string) => void | Promise<void>;
}

type Bubble =
  | { kind: "user"; id: string; text: string; attachment?: string }
  | {
    kind: "result";
    id: string;
    /** easy_messages row, so the result can be written back when it lands. */
    rowId?: string;
    jobId: string;
    prompt: string;
    phase: string;
    status: "running" | "done" | "error";
    error?: string;
    assets: GrokResult[];
    label?: string;
  };

const VIDEO_HINT = /\b(video|animate|animation|clip|moving|motion|make it move)\b/i;

/** Reads a file into the base64 the comfy endpoints expect, capped like Classic. */
async function fileToBase64(file: File, maxDim = 1024): Promise<{ b64: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  let w = bitmap.width, h = bitmap.height;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { b64: dataUrl.split(",")[1], preview: dataUrl };
}

async function urlToBase64(url: string): Promise<string> {
  const blob = await fetch(url).then((r) => r.blob());
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

const round8 = (v: number) => Math.round(Math.max(256, v) / 8) * 8;

/** The only settings Easy varies. Each maps straight onto a parameter the
 *  generate call already takes, so there is nothing here that does nothing. */
const ASPECTS = [
  { id: "portrait", label: "Portrait", w: 832, h: 1216 },
  { id: "square", label: "Square", w: 1024, h: 1024 },
  { id: "landscape", label: "Landscape", w: 1216, h: 832 },
] as const;

// Frame counts match Classic's COMFY duration presets exactly, so the same
// choice costs and lasts the same in both modes. Easy stopped at ~7s while
// Classic went to 15s.
/** The two video engines, described by what a user gets rather than by which
 *  model runs. "quick" is the WAN path Easy has always used; "best" is the LTX
 *  one Classic gained today — sharper because it renders at full size instead
 *  of enlarging afterwards, and the only one with sound. Priced differently:
 *  WAN is flat per clip, LTX per second, so the cost hint is computed, never
 *  written down. */
const VIDEO_QUALITY = [
  { id: "quick", label: "Quick", blurb: "Fast, no sound", flatCredits: 15 },
  { id: "best", label: "Best", blurb: "Sharper, with sound", creditsPerSecond: 7 },
] as const;
type VideoQuality = (typeof VIDEO_QUALITY)[number]["id"];

const LENGTHS = [
  { id: "short", label: "~3s", frames: 49 },
  { id: "normal", label: "~5s", frames: 81 },
  { id: "long", label: "~7s", frames: 113 },
  { id: "xlong", label: "~10s", frames: 161 },
  { id: "max", label: "~15s", frames: 241 },
] as const;

export default function EasyMode({ engines }: { engines: EasyEngines }) {
  const { toast } = useToast();
  const [thread, setThread] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<{ b64: string; preview: string } | null>(null);
  const [assist, setAssistOn] = useState(getAssist);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]["id"]>("portrait");
  const [length, setLength] = useState<(typeof LENGTHS)[number]["id"]>("normal");
  // Defaults to what Easy already did, so nobody's next video silently costs
  // more than their last one. Upgrading is one tap and states its price.
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("quick");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);


  const { results, comfyJobs } = engines;
  const store = useEasyThreads(true);
  const { loadMessages, createThread, selectThread, append: appendMsg, update: updateMsg } = store;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const activeThreadRef = useRef<string | null>(null);
  activeThreadRef.current = store.activeId;

  /** Which thread the bubbles currently on screen belong to.
   *
   *  Without this the first message of a new chat destroys itself. send()
   *  creates the thread, which flips store.activeId, which fires the load
   *  effect below, whose response then overwrites the bubbles that same send
   *  is still building — including the result bubble carrying jobId and
   *  rowId. The render then had no bubble to bind to, so it vanished from the
   *  chat and its assets were never written back. Every message in the
   *  database had an empty assets array because of this. */
  const shownThreadRef = useRef<string | null>(null);

  // Load a thread's history when the user switches to a DIFFERENT thread. A
  // message still marked `running` was interrupted by a reload — the job
  // itself carried on and the render is in the Library, but this tab lost the
  // binding, so say that rather than spinning forever.
  useEffect(() => {
    if (!store.activeId) { shownThreadRef.current = null; setThread([]); return; }
    // Already showing it — a reload here would clobber unsaved local bubbles.
    if (shownThreadRef.current === store.activeId) return;
    shownThreadRef.current = store.activeId;
    let cancelled = false;
    void loadMessages(store.activeId).then((rows: StoredMessage[]) => {
      if (cancelled) return;
      setThread(rows.map((m): Bubble => m.role === "user"
        ? {
          kind: "user", id: m.id, text: m.text || "",
          // The upload the user attached, restored from its stored URL.
          attachment: m.assets?.[0]?.url,
        }
        : {
          kind: "result", id: m.id, rowId: m.id, jobId: "",
          prompt: m.text || "", phase: "",
          status: m.status === "running" ? "error" : (m.status || "done"),
          error: m.status === "running"
            ? "Interrupted by a reload — check your Library for the result."
            : (m.error || undefined),
          assets: (m.assets || []).map((a, i) => ({
            id: `${m.id}-${i}`, url: a.url, previewUrl: a.previewUrl,
            type: a.type, timestamp: 0,
          })),
          label: m.label || undefined,
        }));
    });
    return () => { cancelled = true; };
  }, [store.activeId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread]);

  // Bind live job state (phase, errors) and finished assets onto their bubbles.
  //
  // Reads `thread` directly instead of going through a setThread updater. A
  // state updater must be pure, and this one wrote to the database from inside
  // it — React is free to call an updater more than once, which meant
  // duplicate writes (and double every one of them under StrictMode). The
  // `changed` guard is what stops the `thread` dependency from looping.
  useEffect(() => {
    let changed = false;
    const persist: Array<() => void> = [];
    const next = thread.map((b) => {
      if (b.kind !== "result" || b.status !== "running") return b;
      const job = comfyJobs.find((j) => j.id === b.jobId);
      if (!job) return b;

      if (job.status === "error") {
        changed = true;
        const error = job.error || "Generation failed";
        if (b.rowId) persist.push(() => void updateMsg(b.rowId!, { status: "error", error }));
        return { ...b, status: "error" as const, error, phase: "" };
      }
      if (job.status === "done") {
        // Matched on the job that produced them, not on position. The old
        // "everything above where results started when I submitted" rule gave
        // one bubble another bubble's output the moment two sends overlapped.
        const fresh = results.filter((r) => r.jobId === b.jobId);
        if (fresh.length === 0) return b; // result not prepended yet
        changed = true;
        if (b.rowId) {
          const assets = fresh.map((a) => ({ url: a.url, previewUrl: a.previewUrl, type: a.type }));
          persist.push(() => void updateMsg(b.rowId!, { status: "done", assets }));
        }
        return { ...b, status: "done" as const, phase: "", assets: fresh };
      }
      if (job.phase && job.phase !== b.phase) {
        changed = true;
        return { ...b, phase: job.phase };
      }
      return b;
    });
    if (!changed) return;
    setThread(next);
    persist.forEach((run) => run());
  }, [thread, comfyJobs, results, updateMsg]);

  const lastImage = useMemo(() => {
    for (let i = thread.length - 1; i >= 0; i--) {
      const b = thread[i];
      if (b.kind === "result" && b.status === "done") {
        const img = b.assets.find((a) => a.type === "image");
        if (img) return img.url;
      }
    }
    return null;
  }, [thread]);

  const toggleAssist = () => {
    const v = !assist;
    setAssistOn(v);
    setAssist(v);
  };

  /** DeepSeek, via the enhance-prompt action Classic's prompt box already
   *  uses. Costs 1 credit, which is why it is opt-in and labelled. */
  const enhance = useCallback(async (text: string, mode: string): Promise<string> => {
    try {
      const d = await apiFetch<{ enhanced: string }>("/comfyui", {
        method: "POST",
        body: { action: "enhance-prompt", prompt: text, mode },
      });
      return d.enhanced || text;
    } catch {
      return text; // never block a generation on the assist
    }
  }, []);

  /** `overrideText` re-runs an earlier prompt without the user retyping it —
   *  the "try again" on a finished result. It deliberately does NOT reuse that
   *  result's attachment: a regenerate follows the same rules as typing the
   *  same words now, which keeps what the button does predictable. */
  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || busy) return;
    setBusy(true);

    const attached = overrideText ? null : attachment;
    if (!overrideText) {
      setDraft("");
      setAttachment(null);
    }

    const wantsVideo = VIDEO_HINT.test(text);
    const sourceUrl = attached ? null : lastImage;
    const hasSource = !!attached || !!sourceUrl;

    setThread((p) => [...p, { kind: "user", id: `u-${Date.now()}`, text, attachment: attached?.preview }]);

    try {
      // First message of a new chat creates the thread, titled from that
      // message — the same thing every chat app does.
      let threadId = activeThreadRef.current;
      if (!threadId) {
        threadId = await createThread(text.slice(0, 60));
        if (threadId) {
          // Claim it before selecting, or the load effect races this send and
          // overwrites the bubbles being built here.
          shownThreadRef.current = threadId;
          selectThread(threadId);
        }
      }
      if (threadId) {
        const tid = threadId;
        void appendMsg(tid, { role: "user", text }).then((rowId) => {
          // The attachment reaches the engine as base64, which cannot be
          // stored or re-served, so a reload used to lose the image the user
          // uploaded while keeping their words. Copy it to R2 and hang the URL
          // on the message. Deliberately not awaited before the job starts —
          // the render does not need it, only the history does.
          if (!rowId || !attached) return;
          void (async () => {
            try {
              const blob = await (await fetch(attached.preview)).blob();
              const up = await uploadPublicMedia(blob, "easy", `attach-${Date.now()}.png`);
              await updateMsg(rowId, {
                assets: [{ url: up.url, previewUrl: up.previewUrl, type: "image" }],
              });
              // Swap the local data URL for the stored one so this bubble and a
              // reloaded one show the same image.
              setThread((p) => p.map((b) =>
                b.kind === "user" && b.attachment === attached.preview
                  ? { ...b, attachment: up.url } : b));
            } catch { /* history keeps the text; the image just won't persist */ }
          })();
        });
      }
      // A follow-up with no attachment refines the last image. Without an
      // assist the instruction is concatenated onto the previous prompt, which
      // is what the spec calls a "new take".
      const isFollowUp = !attached && !!sourceUrl;
      const enhanceMode = wantsVideo ? "video" : hasSource ? "edit" : "image";
      const prompt = assist ? await enhance(text, enhanceMode) : text;

      const ar = ASPECTS.find((a) => a.id === aspect)!;
      const len = LENGTHS.find((l) => l.id === length)!;
      let jobId: string | undefined;
      let label: string | undefined;

      if (hasSource && wantsVideo) {
        const b64 = attached?.b64 ?? (await urlToBase64(sourceUrl!));
        if (videoQuality === "best") {
          // LTX sizes from the source frame, matching Classic's animate path:
          // the workflow centre-crops the input to the latent dimensions, so
          // dimensions that ignore the source would crop the subject out.
          // LTX needs multiples of 32.
          const dim = await getImageDimensions(`data:image/jpeg;base64,${b64}`);
          const round32 = (v: number) => Math.max(64, Math.round(v / 32) * 32);
          let w = dim.width, h = dim.height;
          if (w > 1024 || h > 1024) {
            const scale = 1024 / Math.max(w, h);
            w = Math.round(w * scale); h = Math.round(h * scale);
          }
          jobId = engines.ltxVideo({
            prompt,
            imageBase64: b64,
            imageFilename: "easy_input.png",
            width: round32(w), height: round32(h),
            frameCount: len.frames, frameRate: 24,
            audio: true,
          });
          label = "with sound";
        } else {
          jobId = engines.comfyVideo({
            prompt,
            imageBase64: b64,
            workflow: "gltch-wan",
            width: 832, height: 480,
            frameCount: len.frames, steps: 4, cfg: 1,
            resolution: 832, shift: 8,
            useRife: true, useUpscale: false,
          });
        }
      } else if (hasSource) {
        const b64 = attached?.b64 ?? (await urlToBase64(sourceUrl!));
        jobId = engines.comfyEdit({
          prompt,
          imageBase64: b64,
          width: round8(1024), height: round8(1024),
          steps: 4, cfg: 1,
        });
        if (isFollowUp) label = "new take";
      } else {
        jobId = engines.comfyGenerate({
          prompt,
          workflow: "zimage",
          width: ar.w, height: ar.h,
          steps: 8, cfg: 1,
        });
      }

      if (!jobId) throw new Error("Could not start the job");
      const rowId = threadId
        ? await appendMsg(threadId, { role: "result", text: prompt, status: "running", label: label ?? null })
        : null;
      setThread((p) => [...p, {
        kind: "result", id: `r-${jobId}`, rowId: rowId ?? undefined, jobId, prompt,
        phase: "Starting…", status: "running", assets: [], label,
      }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Try again";
      toast({ title: "Couldn't start", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }, [draft, busy, attachment, lastImage, assist, aspect, length, results, engines, enhance, toast,
      createThread, selectThread, appendMsg, updateMsg, videoQuality]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setAttachment(await fileToBase64(f));
    } catch {
      toast({ title: "Couldn't read that image", variant: "destructive" });
    }
  };

  const newChat = () => {
    selectThread(null);
    setThread([]);
    setSidebarOpen(false);
    taRef.current?.focus();
  };

  const threadList = (
    <div className="flex flex-col gap-1 p-2">
      <button
        onClick={newChat}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 font-mono text-[11px] tracking-wider transition-colors"
      >
        <MessageSquarePlus className="w-3.5 h-3.5" /> NEW CHAT
      </button>
      {store.threads.length === 0 && (
        <p className="px-3 py-4 font-mono text-[11px] text-muted-foreground/60">No chats yet.</p>
      )}
      {store.threads.map((t) => (
        <div
          key={t.id}
          className={`group flex items-center gap-1 rounded-lg transition-colors ${t.id === store.activeId ? "bg-primary/10" : "hover:bg-muted/50"
            }`}
        >
          {renamingId === t.id ? (
            /* Titles are frozen at the first 60 characters of the opening
               message, which stops describing the chat almost immediately.
               The rename API already existed with nothing calling it. */
            <form
              className="flex-1 flex items-center gap-1 px-2 py-1"
              onSubmit={(e) => {
                e.preventDefault();
                const title = renameDraft.trim();
                if (title) void store.rename(t.id, title);
                setRenamingId(null);
              }}
            >
              <input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => setRenamingId(null)}
                onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
                maxLength={120}
                className="flex-1 min-w-0 bg-background/80 border border-primary/40 rounded px-2 py-1 font-mono text-[11px] text-foreground"
                aria-label="Chat title"
              />
              {/* onMouseDown, because the input's onBlur would fire first and
                  unmount this button before a click could land. */}
              <button type="submit" onMouseDown={(e) => e.preventDefault()}
                className="p-1 text-primary" aria-label="Save title">
                <Check className="w-3 h-3" />
              </button>
            </form>
          ) : (
            <>
              <button
                onClick={() => { store.selectThread(t.id); setSidebarOpen(false); }}
                className={`flex-1 text-left px-3 py-2 font-mono text-[11px] truncate ${t.id === store.activeId ? "text-primary" : "text-muted-foreground"
                  }`}
              >
                {t.title || "Untitled"}
              </button>
              <button
                onClick={() => { setRenamingId(t.id); setRenameDraft(t.title || ""); }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 text-muted-foreground hover:text-primary transition-opacity"
                aria-label="Rename chat"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  if (window.confirm("Delete this chat? Your images stay in the Library.")) void store.remove(t.id);
                }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 text-muted-foreground hover:text-destructive transition-opacity"
                aria-label="Delete chat"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-var(--easy-chrome,120px))] min-h-[420px]">
      {/* Chat list — a rail on desktop, a slide-over on mobile */}
      <aside className="hidden md:block w-56 shrink-0 border-r border-border/40 overflow-y-auto">
        {threadList}
      </aside>
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="w-64 bg-background border-r border-border/40 overflow-y-auto">{threadList}</div>
          <button
            className="flex-1 bg-black/50"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close chat list"
          />
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border/40">
        <button onClick={() => setSidebarOpen(true)} className="p-1.5 text-muted-foreground hover:text-primary" aria-label="Chats">
          <Menu className="w-4 h-4" />
        </button>
        <span className="font-mono text-[11px] text-muted-foreground truncate">
          {store.threads.find((t) => t.id === store.activeId)?.title || "New chat"}
        </span>
        <button onClick={newChat} className="ml-auto p-1.5 text-muted-foreground hover:text-primary" aria-label="New chat">
          <MessageSquarePlus className="w-4 h-4" />
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-5">
          {thread.length === 0 && (
            <div className="text-center py-20">
              <h2 className="font-orbitron text-xl text-foreground/90">What do you want to make?</h2>
              <p className="mt-3 text-sm text-muted-foreground font-mono">
                Describe it. Attach an image to edit it, or say “animate” to get video.
              </p>
            </div>
          )}

          {thread.map((b) =>
            b.kind === "user" ? (
              <div key={b.id} className="flex justify-end">
                <div className="max-w-[85%] space-y-2">
                  {b.attachment && (
                    <img src={b.attachment} alt="" className="ml-auto rounded-xl max-h-40 border border-border/50" />
                  )}
                  <div className="bg-primary/15 border border-primary/25 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
                    {b.text}
                  </div>
                </div>
              </div>
            ) : (
              <div key={b.id} className="space-y-2">
                {b.label && (
                  <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{b.label.toUpperCase()}</span>
                )}
                {b.status === "running" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    {b.phase || "Working…"}
                    {b.jobId && (
                      <button
                        onClick={() => void engines.cancelComfyJob(b.jobId)}
                        className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-border/50 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                        aria-label="Stop this generation"
                      >
                        <Square className="w-2.5 h-2.5 fill-current" /> Stop
                      </button>
                    )}
                  </div>
                )}
                {b.status === "error" && (
                  <div className="text-sm text-destructive font-mono">{b.error}</div>
                )}
                {b.status === "done" && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 max-w-md">
                      {b.assets.map((a) =>
                        a.type === "video" ? (
                          <video key={a.id} src={a.url} controls playsInline className="w-full rounded-xl border border-border/50" />
                        ) : (
                          <img key={a.id} src={a.url} alt="" className="w-full rounded-xl border border-border/50" />
                        ),
                      )}
                    </div>
                    {/* Only actions that already exist in Classic. */}
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => void send(b.prompt)}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 font-mono text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-40"
                      >
                        <RefreshCw className="w-3 h-3" /> Try again
                      </button>
                      {b.assets[0]?.type === "image" && (
                        <>
                          <button
                            onClick={() => engines.onEditImage(b.assets[0].url)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 font-mono text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                          >
                            <Wand2 className="w-3 h-3" /> Edit in Classic
                          </button>
                          <button
                            onClick={() => engines.onAnimateImage(b.assets[0].url)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 font-mono text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                          >
                            <Video className="w-3 h-3" /> Make video
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer — sticky bottom, above the mobile nav */}
      <div className="sticky bottom-0 border-t border-border/40 bg-background/95 backdrop-blur px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto space-y-2">
          {attachment && (
            <div className="relative inline-block">
              <img src={attachment.preview} alt="" className="h-16 rounded-lg border border-border/50" />
              <button
                onClick={() => setAttachment(null)}
                className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5"
                aria-label="Remove attachment"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {optionsOpen && (
            <div className="border border-border/50 rounded-xl p-3 space-y-3 bg-muted/30">
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] tracking-widest text-muted-foreground">SHAPE</div>
                <div className="flex gap-1.5 flex-wrap">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAspect(a.id)}
                      className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] transition-colors ${aspect === a.id
                        ? "border-primary/50 text-primary bg-primary/10"
                        : "border-border/50 text-muted-foreground hover:border-primary/30"
                        }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] tracking-widest text-muted-foreground">VIDEO LENGTH</div>
                <div className="flex gap-1.5 flex-wrap">
                  {LENGTHS.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLength(l.id)}
                      className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] transition-colors ${length === l.id
                        ? "border-primary/50 text-primary bg-primary/10"
                        : "border-border/50 text-muted-foreground hover:border-primary/30"
                        }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] tracking-widest text-muted-foreground">VIDEO QUALITY</div>
                <div className="flex gap-1.5 flex-wrap">
                  {VIDEO_QUALITY.map((q) => {
                    // Computed from the chosen length so the two prices are
                    // comparable at a glance — one engine bills per clip and
                    // the other per second, which is not obvious from a label.
                    const secs = LENGTHS.find((l) => l.id === length)!.frames / 24;
                    const cost = "flatCredits" in q
                      ? q.flatCredits
                      : Math.round(q.creditsPerSecond * secs);
                    return (
                      <button
                        key={q.id}
                        onClick={() => setVideoQuality(q.id)}
                        className={`px-2.5 py-1 rounded-lg border text-left transition-colors ${videoQuality === q.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/50 hover:border-primary/30"
                          }`}
                      >
                        <div className={`font-mono text-[11px] ${videoQuality === q.id ? "text-primary" : "text-muted-foreground"}`}>
                          {q.label} <span className="text-muted-foreground/60">· ~{cost} cr</span>
                        </div>
                        <div className="font-mono text-[9px] text-muted-foreground/60">{q.blurb}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="font-mono text-[10px] text-muted-foreground/70">
                Everything else — models, LoRAs, seeds, steps — lives in Classic.
              </p>
            </div>
          )}

          <div className="flex items-end gap-2 border border-border/60 rounded-2xl bg-muted/40 px-2 py-1.5 focus-within:border-primary/40 transition-colors">
            <button
              onClick={() => fileRef.current?.click()}
              className="p-2 text-muted-foreground hover:text-primary transition-colors shrink-0"
              aria-label="Attach an image"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
            <textarea
              ref={taRef}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(160, e.target.scrollHeight) + "px";
              }}
              onKeyDown={onKeyDown}
              placeholder="Describe the image or video…"
              className="flex-1 bg-transparent resize-none py-2 text-sm focus:outline-none placeholder:text-muted-foreground/60 max-h-40"
            />
            <button
              onClick={() => void send()}
              disabled={!draft.trim() || busy}
              className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-30 transition-opacity shrink-0"
              aria-label="Send"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setOptionsOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[11px] transition-colors ${optionsOpen
                ? "border-primary/50 text-primary bg-primary/10"
                : "border-border/50 text-muted-foreground hover:text-primary hover:border-primary/40"
                }`}
            >
              <Sliders className="w-3 h-3" /> Options
              {/* The active setting on the button itself. Aspect and length
                  lived entirely behind this toggle, so the only way to know
                  what a send would produce was to open it and look. Shows
                  whichever one the current draft will actually use. */}
              <span className="text-muted-foreground/60">
                · {VIDEO_HINT.test(draft)
                  ? `${LENGTHS.find((l) => l.id === length)!.label} · ${VIDEO_QUALITY.find((q) => q.id === videoQuality)!.label}`
                  : ASPECTS.find((a) => a.id === aspect)!.label}
              </span>
            </button>
            <button
              onClick={toggleAssist}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[11px] transition-colors ${assist
                ? "border-primary/50 text-primary bg-primary/10"
                : "border-border/50 text-muted-foreground hover:text-primary hover:border-primary/40"
                }`}
              title="Rewrite your message into a detailed prompt before generating"
            >
              <Sparkles className="w-3 h-3" /> Prompt assist{assist ? " · on" : ""}
              <span className="text-muted-foreground/70">1 cr</span>
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
