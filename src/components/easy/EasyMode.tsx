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
import { createPortal } from "react-dom";
import { ArrowUp, Check, Loader2, MessageSquarePlus, Menu, Paperclip, Pencil, RefreshCw, Sliders, Sparkles, Square, Trash2, Video, Wand2, X } from "lucide-react";
import { getImageDimensions, type ComfyJob, type GrokResult } from "@/hooks/useGrokApi";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { getAssist, setAssist } from "@/lib/createMode";
import { useEasyThreads, type StoredMessage } from "@/hooks/useEasyThreads";
import { uploadPublicMedia } from "@/lib/mediaUpload";
import { EASY_ASPECTS, ZIMAGE_SIZES } from "@/lib/renderSizes";
import { isWeb3 } from "@/lib/edition";
import { costText } from "@/lib/web3";
import { apiUrl, calculateCreditCost } from "@/lib/api";

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
  /** Re-read the balance after a charge or refund, so the pill stays true. */
  onBalanceChange?: () => void;
  /** Take a cost off every balance display the moment a job starts. */
  deductLocally?: (credits: number) => void;
  /** Open the store (credits) or XRGE bank (web3). */
  onNeedFunds?: () => void;
  /** Open sign-in. */
  onNeedSignIn?: () => void;
}

/** Everything needed to re-run a result exactly as it was made. */
interface RetrySpec {
  route: "image" | "edit" | "video";
  /** The prompt actually sent (already through Prompt assist, if it was on). */
  prompt: string;
  /** What the user typed, for the bubble. */
  userText: string;
  /** The image it was made from, when that was an earlier result. */
  sourceUrl?: string | null;
  /** Made from the user's own upload: the source is that message's attachment. */
  fromAttachment?: boolean;
  aspect?: string;
  length?: string;
  quality?: string;
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
    retry?: RetrySpec;
  };

// Only words that unambiguously ask for video. "clip", "motion" and "moving"
// used to be here and turned "add a paper clip" or "motion blur" into a 15-credit
// video instead of a 3-credit edit.
const VIDEO_HINT = /\b(video|animate|animated|animation|make (?:it|this|them|him|her) move|bring (?:it|this|them|him|her) to life)\b/i;

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
  // no-store: the <img> already loaded this URL without CORS, and reusing that
  // cached copy for a CORS fetch can fail. The timeout turns a hang into an
  // error the user sees instead of a send that silently never starts.
  // Direct first; then through our own /api/download proxy, because the R2
  // bucket only sends CORS headers to the origins listed on it (Studio and
  // web3 weren't), and without them the browser refuses to hand us the bytes.
  const attempt = (u: string) => fetch(u, { cache: "no-store", signal: AbortSignal.timeout(20000) })
    .then((r) => (r.ok ? r : Promise.reject(new Error(String(r.status)))));
  const resp = await attempt(url)
    .catch(() => (/^https?:/.test(url) ? attempt(`${apiUrl("/download")}?inline=1&url=${encodeURIComponent(url)}`) : Promise.reject()))
    .catch(() => { throw new Error("Couldn't load the previous image. Try again."); });
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

const round8 = (v: number) => Math.round(Math.max(256, v) / 8) * 8;

/** The only settings Easy varies. Each maps straight onto a parameter the
 *  generate call already takes, so there is nothing here that does nothing.
 *
 *  Dimensions come from the shared table rather than being repeated here —
 *  these three used to carry their own copies of numbers that also lived in
 *  Classic's picker, agreeing by coincidence rather than by construction. */
const ASPECTS = EASY_ASPECTS.map((a) => ({
  ...a,
  w: ZIMAGE_SIZES[a.aspect][0],
  h: ZIMAGE_SIZES[a.aspect][1],
}));

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

// `frames` is WAN at 16fps (Classic's presets); LTX renders 24fps, so it gets
// its own count for the same length.
const LENGTHS = [
  { id: "short", label: "~3s", frames: 49, secs: 3 },
  { id: "normal", label: "~5s", frames: 81, secs: 5 },
  { id: "long", label: "~7s", frames: 113, secs: 7 },
  { id: "xlong", label: "~10s", frames: 161, secs: 10 },
  { id: "max", label: "~15s", frames: 241, secs: 15 },
] as const;
const LTX_FPS = 24;
const ltxFrames = (secs: number) => secs * LTX_FPS + 1;
/** Mirrors ltxCostForFrames in api/comfyui.ts, so the price shown is the price charged. */
const ltxCredits = (frames: number, perSec: number) => Math.max(1, Math.round(frames / LTX_FPS)) * perSec;

export default function EasyMode({ engines }: { engines: EasyEngines }) {
  const { toast } = useToast();
  const [thread, setThread] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<{ b64: string; preview: string } | null>(null);
  const [assist, setAssistOn] = useState(getAssist);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [aspect, setAspect] = useState<(typeof EASY_ASPECTS)[number]["id"]>("portrait");
  const [length, setLength] = useState<(typeof LENGTHS)[number]["id"]>("normal");
  // Defaults to what Easy already did, so nobody's next video silently costs
  // more than their last one. Upgrading is one tap and states its price.
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("quick");
  const [busy, setBusy] = useState(false);
  // React state is stale within one tick, so two Enter presses both saw
  // busy=false and started two generations. This ref flips synchronously.
  const inFlightRef = useRef(false);
  // jobId -> easy_messages row, for every job this tab started. Lives outside
  // the bubbles so a result is saved even when its thread isn't on screen.
  const bindingsRef = useRef(new Map<string, string | undefined>());
  const finalizedRef = useRef(new Set<string>());
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
        : (() => {
          // Still running in this tab (the user just switched threads):
          // re-attach it instead of calling it interrupted.
          const liveJob = m.status === "running"
            ? [...bindingsRef.current.entries()].find(([, row]) => row === m.id)?.[0]
            : undefined;
          return {
          kind: "result" as const, id: m.id, rowId: m.id, jobId: liveJob || "",
          prompt: m.text || "", phase: liveJob ? "Working…" : "",
          status: liveJob ? "running" as const : m.status === "running" ? "error" as const : (m.status || "done"),
          error: m.status === "running" && !liveJob
            ? "Interrupted by a reload — check your Library for the result."
            : (m.error || undefined),
          retry: (m.meta as unknown as RetrySpec | undefined) || undefined,
          assets: (m.assets || []).map((a, i) => ({
            id: `${m.id}-${i}`, url: a.url, previewUrl: a.previewUrl,
            type: a.type, timestamp: 0,
          })),
          label: m.label || undefined,
          };
        })()));
    });
    return () => { cancelled = true; };
  }, [store.activeId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread]);

  /** Small images come back from the poll as inline data: URLs, which the
   *  history can't store, so every image used to vanish on reload. Copy them
   *  to R2 first; videos already arrive as R2 URLs. */
  const storableAssets = useCallback(async (assets: GrokResult[]) => Promise.all(assets.map(async (a) => {
    if (!a.url.startsWith("data:")) return { url: a.url, previewUrl: a.previewUrl, type: a.type };
    try {
      const blob = await (await fetch(a.url)).blob();
      const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
      const up = await uploadPublicMedia(blob, "easy", `result-${Date.now()}.${ext}`);
      return { url: up.url, previewUrl: up.previewUrl, type: a.type };
    } catch {
      return null;
    }
  })).then((list) => list.filter((a): a is NonNullable<typeof a> => !!a)), []);

  // Save every job this tab started when it finishes — whether or not its
  // thread is on screen — then swap any data: URLs on screen for stored ones.
  useEffect(() => {
    for (const [jobId, rowId] of bindingsRef.current) {
      if (finalizedRef.current.has(jobId)) continue;
      const job = comfyJobs.find((j) => j.id === jobId);
      if (!job) continue;
      if (job.status === "error") {
        finalizedRef.current.add(jobId);
        bindingsRef.current.delete(jobId);
        const error = job.error || "Generation failed";
        if (rowId) void updateMsg(rowId, { status: "error", error });
        engines.onBalanceChange?.(); // failures refund
        if (/not enough (credits|xrge)/i.test(error)) engines.onNeedFunds?.();
        else if (/sign in/i.test(error)) engines.onNeedSignIn?.();
        continue;
      }
      if (job.status === "done") {
        const fresh = results.filter((r) => r.jobId === jobId);
        if (fresh.length === 0) continue; // result not prepended yet
        finalizedRef.current.add(jobId);
        bindingsRef.current.delete(jobId);
        engines.onBalanceChange?.();
        void storableAssets(fresh).then((stored) => {
          if (rowId) void updateMsg(rowId, { status: "done", assets: stored });
          const byIndex = fresh.map((f, i) => ({ ...f, url: stored[i]?.url ?? f.url, previewUrl: stored[i]?.previewUrl ?? f.previewUrl }));
          setThread((p) => p.map((b) => b.kind === "result" && b.jobId === jobId && b.status === "done"
            ? { ...b, assets: byIndex } : b));
        });
      }
    }
  }, [comfyJobs, results, updateMsg, storableAssets, engines]);

  // Mirror live job state (phase, errors, finished assets) onto the bubbles on
  // screen. Display only — saving is the effect above.
  useEffect(() => {
    let changed = false;
    const next = thread.map((b) => {
      if (b.kind !== "result" || b.status !== "running") return b;
      const job = comfyJobs.find((j) => j.id === b.jobId);
      if (!job) return b;
      if (job.status === "error") {
        changed = true;
        return { ...b, status: "error" as const, error: job.error || "Generation failed", phase: "" };
      }
      if (job.status === "done") {
        // Matched on the job that produced them, not on position.
        const fresh = results.filter((r) => r.jobId === b.jobId);
        if (fresh.length === 0) return b;
        changed = true;
        return { ...b, status: "done" as const, phase: "", assets: fresh };
      }
      if (job.phase && job.phase !== b.phase) {
        changed = true;
        return { ...b, phase: job.phase };
      }
      return b;
    });
    if (changed) setThread(next);
  }, [thread, comfyJobs, results]);

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
      engines.deductLocally?.(1);
      return d.enhanced || text;
    } catch {
      return text; // never block a generation on the assist
    }
  }, [engines]);

  /** Find the upload a result was made from: the attachment on the user
   *  message just before it. */
  const attachmentBefore = useCallback((resultId: string): string | null => {
    const i = thread.findIndex((b) => b.id === resultId);
    for (let j = i - 1; j >= 0; j--) {
      const b = thread[j];
      if (b.kind === "user") return b.attachment ?? null;
    }
    return null;
  }, [thread]);

  /** A new message, or (with `retry`) an exact re-run of an earlier result:
   *  same route, same source, same prompt, no second Prompt assist. */
  const send = useCallback(async (retry?: RetrySpec & { resultId?: string }) => {
    const text = (retry ? retry.userText : draft).trim();
    if (!text || inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);

    const attached = retry ? null : attachment;
    if (!retry) {
      setDraft("");
      setAttachment(null);
      if (taRef.current) taRef.current.style.height = "auto";
    }

    let sourceUrl: string | null;
    let route: RetrySpec["route"];
    if (retry) {
      route = retry.route;
      sourceUrl = retry.fromAttachment && retry.resultId
        ? attachmentBefore(retry.resultId)
        : (retry.sourceUrl ?? null);
    } else {
      sourceUrl = attached ? null : lastImage;
      const hasSrc = !!attached || !!sourceUrl;
      route = hasSrc && VIDEO_HINT.test(text) ? "video" : hasSrc ? "edit" : "image";
    }
    const quality = (retry?.quality as VideoQuality | undefined) ?? videoQuality;
    const lengthId = retry?.length ?? length;
    const aspectId = retry?.aspect ?? aspect;

    setThread((p) => [...p, { kind: "user", id: `u-${Date.now()}`, text, attachment: attached?.preview }]);

    try {
      if (route !== "image" && !attached && !sourceUrl) {
        throw new Error("The image this was made from isn't available anymore.");
      }
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
        // Awaited so the user's message is stored before its result; saving
        // it in the background let the result land first and show above it.
        let rowId = await appendMsg(threadId, { role: "user", text });
        if (!rowId) {
          // The remembered thread is gone (deleted elsewhere, other account):
          // start a fresh one rather than silently saving nothing.
          threadId = await createThread(text.slice(0, 60));
          if (threadId) {
            shownThreadRef.current = threadId;
            selectThread(threadId);
            rowId = await appendMsg(threadId, { role: "user", text });
          }
        }
        // The attachment reaches the engine as base64, which cannot be stored
        // or re-served; copy it to R2 for the history, in the background.
        if (rowId && attached) {
          const userRow = rowId;
          void (async () => {
            try {
              const blob = await (await fetch(attached.preview)).blob();
              const up = await uploadPublicMedia(blob, "easy", `attach-${Date.now()}.jpg`);
              await updateMsg(userRow, {
                assets: [{ url: up.url, previewUrl: up.previewUrl, type: "image" }],
              });
              setThread((p) => p.map((b) =>
                b.kind === "user" && b.attachment === attached.preview
                  ? { ...b, attachment: up.url } : b));
            } catch { /* history keeps the text; the image just won't persist */ }
          })();
        }
      }

      const isFollowUp = !attached && !!sourceUrl && !retry?.fromAttachment;
      const prompt = retry
        ? retry.prompt
        : assist ? await enhance(text, route === "video" ? "video" : route === "edit" ? "edit" : "image") : text;

      const ar = ASPECTS.find((a) => a.id === aspectId) ?? ASPECTS[0];
      const len = LENGTHS.find((l) => l.id === lengthId) ?? LENGTHS[1];
      let jobId: string | undefined;
      let label: string | undefined;

      if (route === "video") {
        const b64 = attached?.b64 ?? (await urlToBase64(sourceUrl!));
        if (quality === "best") {
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
            frameCount: ltxFrames(len.secs), frameRate: LTX_FPS,
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
      } else if (route === "edit") {
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
      if (retry) label = label ? `${label} · again` : "again";

      if (!jobId) throw new Error("Could not start the job");
      const spec: RetrySpec = {
        route, prompt, userText: text,
        // Only a stored URL survives a reload; an upload is found again via
        // the user message it was attached to.
        // In this tab a data: URL still works; the API keeps only stored URLs.
        sourceUrl,
        fromAttachment: !!attached || !!retry?.fromAttachment,
        aspect: aspectId, length: lengthId, quality,
      };
      const rowId = threadId
        ? await appendMsg(threadId, { role: "result", text: prompt, status: "running", label: label ?? null, meta: spec as unknown as Record<string, unknown> })
        : null;
      bindingsRef.current.set(jobId, rowId ?? undefined);
      setThread((p) => [...p, {
        kind: "result", id: `r-${jobId}`, rowId: rowId ?? undefined, jobId, prompt,
        phase: "Starting…", status: "running", assets: [], label, retry: spec,
      }]);
      engines.deductLocally?.(
        route === "image" ? calculateCreditCost("comfy-image")
          : route === "edit" ? calculateCreditCost("comfy-edit")
            : quality === "best" ? ltxCredits(ltxFrames(len.secs), VIDEO_QUALITY[1].creditsPerSecond)
              : VIDEO_QUALITY[0].flatCredits,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Try again";
      toast({ title: "Couldn't start", description: msg, variant: "destructive" });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
      taRef.current?.focus();
    }
  }, [draft, attachment, lastImage, assist, aspect, length, engines, enhance, toast,
      createThread, selectThread, appendMsg, updateMsg, videoQuality, attachmentBefore]);

  /** Rows saved before retry specs existed: only a plain text-to-image can be
   *  re-run faithfully, so only those keep the button. */
  const retryFor = (b: Extract<Bubble, { kind: "result" }>): (RetrySpec & { resultId: string }) | null =>
    b.retry ? { ...b.retry, resultId: b.id }
      : !b.label && b.prompt ? { route: "image", prompt: b.prompt, userText: b.prompt, resultId: b.id }
        : null;

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
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 font-mono text-xs tracking-wider transition-colors"
      >
        <MessageSquarePlus className="w-3.5 h-3.5" /> New chat
      </button>
      {store.threads.length === 0 && (
        <p className="px-3 py-4 font-mono text-xs text-muted-foreground/60">No chats yet.</p>
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
                className="flex-1 min-w-0 bg-background/80 border border-primary/40 rounded px-2 py-1 font-mono text-xs text-foreground"
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
                className={`flex-1 text-left px-3 py-2 font-mono text-xs truncate ${t.id === store.activeId ? "text-primary" : "text-muted-foreground"
                  }`}
              >
                {t.title || "Untitled"}
              </button>
              <button
                onClick={() => { setRenamingId(t.id); setRenameDraft(t.title || ""); }}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 p-1.5 text-muted-foreground hover:text-primary transition-opacity"
                aria-label="Rename chat"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  if (window.confirm("Delete this chat? Your images stay in the Library.")) void store.remove(t.id);
                }}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 p-1.5 text-muted-foreground hover:text-destructive transition-opacity"
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
      {/* Portaled: inside the page's z-20 stacking context no z-index could
          lift it above the fixed app header, which covered "New chat". */}
      {sidebarOpen && createPortal(
        <div className="md:hidden fixed inset-0 z-[60] flex">
          <div className="w-64 bg-background border-r border-border/40 overflow-y-auto pt-[env(safe-area-inset-top)]">{threadList}</div>
          <button
            className="flex-1 bg-black/50"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close chat list"
          />
        </div>,
        document.body,
      )}

      <div className="flex flex-col flex-1 min-w-0">
      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border/40">
        <button onClick={() => setSidebarOpen(true)} className="p-1.5 text-muted-foreground hover:text-primary" aria-label="Chats">
          <Menu className="w-4 h-4" />
        </button>
        <span className="font-mono text-xs text-muted-foreground truncate">
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
                Describe it. Attach an image to edit it, then say “animate” to turn an image into video.
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
                  <div className="bg-primary/15 border border-primary/25 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {b.text}
                  </div>
                </div>
              </div>
            ) : (
              <div key={b.id} className="space-y-2">
                {b.label && (
                  <span className="font-mono text-tiny tracking-widest text-muted-foreground">{b.label.toUpperCase()}</span>
                )}
                {b.status === "running" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    {b.phase || "Working…"}
                    {b.jobId && (
                      <button
                        onClick={() => void engines.cancelComfyJob(b.jobId)}
                        className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-border/50 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                        aria-label="Stop this generation"
                      >
                        <Square className="w-2.5 h-2.5 fill-current" /> Stop
                      </button>
                    )}
                  </div>
                )}
                {b.status === "error" && (
                  <div className="space-y-2">
                    <div className="text-sm text-destructive font-mono">{b.error}</div>
                    <div className="flex gap-2 flex-wrap">
                      {/not enough (credits|xrge)/i.test(b.error || "") && engines.onNeedFunds && (
                        <button
                          onClick={engines.onNeedFunds}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-primary/40 font-mono text-xs text-primary hover:bg-primary/10 transition-colors"
                        >
                          {isWeb3 ? "Deposit XRGE" : "Get credits"}
                        </button>
                      )}
                      {/sign in/i.test(b.error || "") && engines.onNeedSignIn && (
                        <button
                          onClick={engines.onNeedSignIn}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-primary/40 font-mono text-xs text-primary hover:bg-primary/10 transition-colors"
                        >
                          Sign in
                        </button>
                      )}
                      {retryFor(b) && (
                        <button
                          onClick={() => void send(retryFor(b)!)}
                          disabled={busy}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 font-mono text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-40"
                        >
                          <RefreshCw className="w-3 h-3" /> Try again
                        </button>
                      )}
                    </div>
                  </div>
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
                      {retryFor(b) && (
                        <button
                          onClick={() => void send(retryFor(b)!)}
                          disabled={busy}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 font-mono text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-40"
                        >
                          <RefreshCw className="w-3 h-3" /> Try again
                        </button>
                      )}
                      {b.assets[0]?.type === "video" && (
                        <a
                          href={b.assets[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 font-mono text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                        >
                          <Video className="w-3 h-3" /> Open video
                        </a>
                      )}
                      {b.assets[0]?.type === "image" && (
                        <>
                          <button
                            onClick={() => engines.onEditImage(b.assets[0].url)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 font-mono text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                          >
                            <Wand2 className="w-3 h-3" /> Edit in Classic
                          </button>
                          <button
                            onClick={() => engines.onAnimateImage(b.assets[0].url)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 font-mono text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
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
                <div className="font-mono text-tiny tracking-widest text-muted-foreground">Shape</div>
                <div className="flex gap-1.5 flex-wrap">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAspect(a.id)}
                      className={`px-2.5 py-1 rounded-lg border font-mono text-xs transition-colors ${aspect === a.id
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
                <div className="font-mono text-tiny tracking-widest text-muted-foreground">Video length</div>
                <div className="flex gap-1.5 flex-wrap">
                  {LENGTHS.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLength(l.id)}
                      className={`px-2.5 py-1 rounded-lg border font-mono text-xs transition-colors ${length === l.id
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
                <div className="font-mono text-tiny tracking-widest text-muted-foreground">Video quality</div>
                <div className="flex gap-1.5 flex-wrap">
                  {VIDEO_QUALITY.map((q) => {
                    // Computed from the chosen length so the two prices are
                    // comparable at a glance — one engine bills per clip and
                    // the other per second, which is not obvious from a label.
                    const len = LENGTHS.find((l) => l.id === length)!;
                    const cost = "flatCredits" in q
                      ? q.flatCredits
                      : ltxCredits(ltxFrames(len.secs), q.creditsPerSecond);
                    return (
                      <button
                        key={q.id}
                        onClick={() => setVideoQuality(q.id)}
                        className={`px-2.5 py-1 rounded-lg border text-left transition-colors ${videoQuality === q.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/50 hover:border-primary/30"
                          }`}
                      >
                        <div className={`font-mono text-xs ${videoQuality === q.id ? "text-primary" : "text-muted-foreground"}`}>
                          {q.label} <span className="text-muted-foreground/60">· {costText(cost, isWeb3)}</span>
                        </div>
                        <div className="font-mono text-tiny text-muted-foreground/60">{q.blurb}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="font-mono text-tiny text-muted-foreground/70">
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
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-xs transition-colors ${optionsOpen
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
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-xs transition-colors ${assist
                ? "border-primary/50 text-primary bg-primary/10"
                : "border-border/50 text-muted-foreground hover:text-primary hover:border-primary/40"
                }`}
              title="Rewrite your message into a detailed prompt before generating"
            >
              <Sparkles className="w-3 h-3" /> Prompt assist{assist ? " · on" : ""}
              <span className="text-muted-foreground/70">{costText(1, isWeb3)}</span>
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
