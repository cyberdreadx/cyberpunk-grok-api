import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Cpu,
  Wifi,
  WifiOff,
  Play,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  X,
  Trash2,
  Film,
} from "lucide-react";
import { apiFetch, CREDIT_COSTS } from "@/lib/api";
import type { GrokResult } from "@/hooks/useGrokApi";

/* ─── Job types ─── */
type WorkflowMode = "txt2img" | "qwen-edit" | "wan-video";

interface ComfyJob {
  id: string;
  promptId: string | null;
  status: "submitting" | "generating" | "done" | "error";
  image: string | null;
  video: string | null;
  error: string | null;
  seed: number | null;
  elapsed: number;
  label: string;
  workflowMode: WorkflowMode;
  outputType: "image" | "video";
}

const SIZES = [512, 768, 1024, 1080, 1280, 1536, 1920];
const VIDEO_SIZES = [480, 512, 640, 768, 832, 1024];
const FRAME_PRESETS = [
  { label: "~2s (33f)", value: 33 },
  { label: "~3s (49f)", value: 49 },
  { label: "~5s (81f)", value: 81 },
  { label: "~7s (113f)", value: 113 },
  { label: "~10s (161f)", value: 161 },
];

/* ─── Persistent job storage (survives page close / refresh) ─── */
const PENDING_JOBS_KEY = "comfy-pending-jobs";
const JOB_MAX_AGE_MS = 30 * 60 * 1000; // 30 min — RunPod jobs expire after this

interface PendingJob {
  id: string;
  promptId: string;
  outputType: "image" | "video";
  workflowMode: WorkflowMode;
  label: string;
  prompt: string;
  seed: number | null;
  submittedAt: number;
}

function loadPendingJobs(): PendingJob[] {
  try {
    const raw = localStorage.getItem(PENDING_JOBS_KEY);
    if (!raw) return [];
    const jobs: PendingJob[] = JSON.parse(raw);
    // Filter out expired jobs
    const now = Date.now();
    return jobs.filter((j) => now - j.submittedAt < JOB_MAX_AGE_MS);
  } catch {
    return [];
  }
}

function savePendingJobs(jobs: PendingJob[]) {
  try {
    localStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(jobs));
  } catch { /* quota exceeded — best effort */ }
}

function addPendingJob(job: PendingJob) {
  const current = loadPendingJobs();
  current.push(job);
  savePendingJobs(current);
}

function removePendingJob(jobId: string) {
  const current = loadPendingJobs();
  savePendingJobs(current.filter((j) => j.id !== jobId));
}

interface ComfyPanelProps {
  /** Called when a job finishes successfully, to persist the result in the main gallery. */
  onResultReady?: (result: GrokResult) => void | Promise<void>;
}

export default function ComfyPanel({ onResultReady }: ComfyPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [connected, setConnected] = useState(false);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [selectedCkpt, setSelectedCkpt] = useState("");
  const [loras, setLoras] = useState<string[]>([]);
  const [selectedLora, setSelectedLora] = useState("none");
  const [loraStrength, setLoraStrength] = useState(0.8);

  // Workflow mode
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("qwen-edit");

  // Image upload (for qwen-edit & wan-video)
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [inputImageName, setInputImageName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared params
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1536);
  const [steps, setSteps] = useState(5);
  const [cfg, setCfg] = useState(1);
  const [seed, setSeed] = useState("");
  const [upscale, setUpscale] = useState(false);

  // WAN video-specific params
  const [frameCount, setFrameCount] = useState(81);
  const [useRife, setUseRife] = useState(true);
  const [useVidUpscale, setUseVidUpscale] = useState(false);

  /* ─── Job queue ─── */
  const [jobs, setJobs] = useState<ComfyJob[]>([]);
  const pollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const timerRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const startRefs = useRef<Map<string, number>>(new Map());
  const doneRefs = useRef<Set<string>>(new Set()); // guard against duplicate poll completions

  const activeCount = jobs.filter(
    (j) => j.status === "submitting" || j.status === "generating"
  ).length;

  const lastSeed = [...jobs].reverse().find((j) => j.seed !== null)?.seed ?? null;

  // Does this mode need a start image?
  const needsImage = workflowMode === "qwen-edit" || workflowMode === "wan-video";
  // Does this mode use checkpoint selection? (qwen-edit uses a fixed model, wan-video too)
  const needsCheckpoint = workflowMode === "txt2img";

  /* ─── Cleanup all intervals on unmount ─── */
  useEffect(() => {
    return () => {
      pollRefs.current.forEach((iv) => clearInterval(iv));
      timerRefs.current.forEach((iv) => clearInterval(iv));
    };
  }, []);

  /* ─── Helpers ─── */
  const clearJobIntervals = useCallback((jobId: string) => {
    const poll = pollRefs.current.get(jobId);
    if (poll) { clearInterval(poll); pollRefs.current.delete(jobId); }
    const timer = timerRefs.current.get(jobId);
    if (timer) { clearInterval(timer); timerRefs.current.delete(jobId); }
    startRefs.current.delete(jobId);
  }, []);

  const updateJob = useCallback((jobId: string, patch: Partial<ComfyJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j)));
  }, []);

  /* ─── Server connectivity ─── */
  const checkStatus = useCallback(async () => {
    try {
      await apiFetch("/comfyui", { method: "POST", body: { action: "status" } });
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const data = await apiFetch<{ checkpoints: string[]; loras?: string[] }>("/comfyui", {
        method: "POST",
        body: { action: "models" },
      });
      setCheckpoints(data.checkpoints || []);
      if (data.checkpoints?.length && !selectedCkpt) {
        setSelectedCkpt(data.checkpoints[0]);
      }
      setLoras(data.loras || []);
    } catch {
      setCheckpoints([]);
      setLoras([]);
    }
  }, [selectedCkpt]);

  useEffect(() => {
    if (!collapsed) { checkStatus(); fetchModels(); }
  }, [collapsed, checkStatus, fetchModels]);

  /* ─── Image upload handling ─── */
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const jpeg = canvas.toDataURL("image/jpeg", 0.92);
        setInputImage(jpeg);
        setInputImageName(`${baseName}.jpg`);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
  };

  const clearImage = () => {
    setInputImage(null);
    setInputImageName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /* ─── Polling for a specific job ─── */
  const startPolling = useCallback(
    (jobId: string, pid: string, outType: "image" | "video", promptText: string) => {
      const existing = pollRefs.current.get(jobId);
      if (existing) clearInterval(existing);

      const iv = setInterval(async () => {
        // Guard: if this job already completed, skip (prevents race with overlapping polls)
        if (doneRefs.current.has(jobId)) return;

        try {
          const data = await apiFetch<{
            status: string;
            image?: string;
            video?: string;
            error?: string;
          }>("/comfyui", {
            method: "POST",
            body: { action: "poll", promptId: pid, outputType: outType },
          });

          // Double-check guard after async call
          if (doneRefs.current.has(jobId)) return;

          if (data.status === "done") {
            doneRefs.current.add(jobId);
            clearJobIntervals(jobId);
            removePendingJob(jobId);
            const imgSrc = data.image || null;
            const vidSrc = data.video || null;
            updateJob(jobId, {
              status: "done",
              image: imgSrc,
              video: vidSrc,
            });
            // Persist to main gallery
            const src = vidSrc || imgSrc;
            if (src && onResultReady) {
              try {
                await onResultReady({
                  id: `comfy-${jobId}-${Date.now()}`,
                  url: src,
                  type: vidSrc ? "video" : "image",
                  revised_prompt: promptText,
                  timestamp: Date.now(),
                });
                console.log("[ComfyPanel] Result saved to gallery:", jobId);
              } catch (saveErr) {
                console.error("[ComfyPanel] Failed to save result to gallery:", saveErr);
              }
            } else if (!src) {
              console.warn("[ComfyPanel] Job done but no image/video in response:", data);
            }
          } else if (data.status === "error") {
            doneRefs.current.add(jobId);
            clearJobIntervals(jobId);
            removePendingJob(jobId);
            updateJob(jobId, {
              status: "error",
              error: data.error || "Generation failed",
            });
          }
        } catch (err: any) {
          // Only set error if job hasn't already been resolved
          if (!doneRefs.current.has(jobId)) {
            doneRefs.current.add(jobId);
            clearJobIntervals(jobId);
            removePendingJob(jobId);
            updateJob(jobId, {
              status: "error",
              error: err.message || "Poll failed",
            });
          }
        }
      }, workflowMode === "wan-video" ? 5000 : 2000);

      pollRefs.current.set(jobId, iv);
    },
    [clearJobIntervals, updateJob, workflowMode, onResultReady]
  );

  /* ─── Resume pending jobs on mount (survives page close / refresh) ─── */
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;

    const pending = loadPendingJobs();
    if (pending.length === 0) return;

    console.log(`[ComfyPanel] Resuming ${pending.length} pending job(s) from previous session`);

    const restoredJobs: ComfyJob[] = pending.map((pj) => ({
      id: pj.id,
      promptId: pj.promptId,
      status: "generating" as const,
      image: null,
      video: null,
      error: null,
      seed: pj.seed,
      elapsed: Math.floor((Date.now() - pj.submittedAt) / 1000),
      label: pj.label,
      workflowMode: pj.workflowMode,
      outputType: pj.outputType,
    }));

    setJobs((prev) => [...restoredJobs, ...prev]);

    // Auto-expand the panel so the user sees their resumed jobs
    if (restoredJobs.length > 0) setCollapsed(false);

    // Start polling + elapsed timers for each restored job
    for (const pj of pending) {
      startRefs.current.set(pj.id, pj.submittedAt);
      const timerIv = setInterval(() => {
        const start = startRefs.current.get(pj.id);
        if (start) {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === pj.id
                ? { ...j, elapsed: Math.floor((Date.now() - start) / 1000) }
                : j
            )
          );
        }
      }, 1000);
      timerRefs.current.set(pj.id, timerIv);
      startPolling(pj.id, pj.promptId, pj.outputType, pj.prompt);
    }
  }, [startPolling]);

  /* ─── Generate ─── */
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (needsCheckpoint && !selectedCkpt) return;
    if (needsImage && !inputImage) return;

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label =
      prompt.trim().length > 50
        ? prompt.trim().slice(0, 50) + "…"
        : prompt.trim();

    const outType = workflowMode === "wan-video" ? "video" as const : "image" as const;

    const newJob: ComfyJob = {
      id: jobId,
      promptId: null,
      status: "submitting",
      image: null,
      video: null,
      error: null,
      seed: null,
      elapsed: 0,
      label,
      workflowMode,
      outputType: outType,
    };

    setJobs((prev) => [newJob, ...prev]);

    startRefs.current.set(jobId, Date.now());
    const timerIv = setInterval(() => {
      const start = startRefs.current.get(jobId);
      if (start) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, elapsed: Math.floor((Date.now() - start) / 1000) }
              : j
          )
        );
      }
    }, 1000);
    timerRefs.current.set(jobId, timerIv);

    try {
      const body: Record<string, any> = {
        action: "generate",
        workflow: workflowMode,
        prompt: prompt.trim(),
        negativePrompt: negPrompt.trim() || undefined,
        width,
        height,
        steps,
        cfg,
        seed: seed.trim() ? parseInt(seed, 10) : undefined,
      };

      // Checkpoint: txt2img uses user-selected, qwen-edit is fixed server-side
      if (needsCheckpoint) body.checkpoint = selectedCkpt;

      // LoRA (txt2img only)
      if (workflowMode === "txt2img" && selectedLora && selectedLora !== "none") {
        body.lora = selectedLora;
        body.loraStrength = loraStrength;
      }

      // Image data (qwen-edit & wan-video)
      if (needsImage) {
        body.imageBase64 = inputImage;
        body.imageFilename = inputImageName;
      }

      // Workflow-specific params
      if (workflowMode === "qwen-edit") {
        body.upscale = upscale || undefined;
      }
      if (workflowMode === "wan-video") {
        body.frameCount = frameCount;
        body.useRife = useRife;
        body.useUpscale = useVidUpscale;
      }

      const data = await apiFetch<{ promptId: string; seed: number; outputType?: string }>(
        "/comfyui",
        { method: "POST", body }
      );

      updateJob(jobId, {
        promptId: data.promptId,
        seed: data.seed,
        status: "generating",
      });

      // Persist so the job survives page close / refresh
      addPendingJob({
        id: jobId,
        promptId: data.promptId,
        outputType: outType,
        workflowMode,
        label,
        prompt: prompt.trim(),
        seed: data.seed,
        submittedAt: Date.now(),
      });

      startPolling(jobId, data.promptId, outType, prompt.trim());
    } catch (err: any) {
      clearJobIntervals(jobId);
      updateJob(jobId, {
        status: "error",
        error: err.message || "Submission failed",
      });
    }
  };

  /* ─── Per-job actions ─── */
  const handleDownload = (job: ComfyJob) => {
    const src = job.video || job.image;
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = job.video
      ? `comfy_${job.seed || "output"}.mp4`
      : `comfy_${job.seed || "output"}.png`;
    a.click();
  };

  const dismissJob = (jobId: string) => {
    clearJobIntervals(jobId);
    doneRefs.current.delete(jobId);
    removePendingJob(jobId);
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  };

  const clearFinished = () => {
    setJobs((prev) => {
      const keep: ComfyJob[] = [];
      for (const j of prev) {
        if (j.status === "submitting" || j.status === "generating") {
          keep.push(j);
        } else {
          doneRefs.current.delete(j.id);
          removePendingJob(j.id);
          clearJobIntervals(j.id);
        }
      }
      return keep;
    });
  };

  /* ─── Mode switch helper ─── */
  const switchMode = (m: WorkflowMode) => {
    setWorkflowMode(m);
    if (m === "qwen-edit") {
      setSteps(5); setCfg(1); setWidth(1024); setHeight(1536);
    } else if (m === "wan-video") {
      setSteps(4); setCfg(1); setWidth(480); setHeight(768);
      setFrameCount(81); setUseRife(true); setUseVidUpscale(false);
    } else {
      setSteps(20); setCfg(7); setWidth(1024); setHeight(1024);
    }
  };

  /* ─── Credit cost for current mode ─── */
  const currentCost =
    workflowMode === "wan-video"
      ? CREDIT_COSTS.comfyVideo
      : workflowMode === "qwen-edit"
      ? upscale ? CREDIT_COSTS.comfyEditHd : CREDIT_COSTS.comfyEdit
      : CREDIT_COSTS.comfyImage;

  /* ─── Styles ─── */
  const inputClass =
    "w-full bg-black/60 border border-cyan-500/30 rounded px-3 py-2 text-sm font-mono text-cyan-100 placeholder-cyan-800 focus:outline-none focus:border-cyan-400/60";
  const labelClass =
    "block text-[10px] font-mono text-cyan-400/70 mb-1 uppercase tracking-wider";
  const toggleBaseClass =
    "w-9 h-5 bg-black/60 border border-cyan-500/30 rounded-full peer peer-checked:bg-purple-600/60 peer-checked:border-purple-400/60 relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-gray-400 after:rounded-full after:transition-all peer-checked:after:translate-x-4 peer-checked:after:bg-white";

  // Which sizes to show based on mode
  const sizeOptions = workflowMode === "wan-video" ? VIDEO_SIZES : SIZES;

  // Determine if generate button should be disabled
  const generateDisabled =
    !prompt.trim() ||
    !connected ||
    (needsCheckpoint && !selectedCkpt) ||
    (needsImage && !inputImage);

  return (
    <div className="mb-6">
      {/* Toggle header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-gradient-to-r from-purple-900/40 via-indigo-900/30 to-purple-900/40 border border-purple-500/40 rounded-lg hover:border-purple-400/60 hover:from-purple-900/50 hover:via-indigo-900/40 hover:to-purple-900/50 transition-all group"
      >
        <div className="flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-mono font-semibold tracking-wider text-purple-300 uppercase">
            Comfy_Lab
          </span>
          <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-widest bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">
            New
          </span>
          {collapsed && (
            <span className="hidden sm:inline text-[9px] font-mono text-purple-400/50">
              AI Video &amp; Image Studio
            </span>
          )}
          {!collapsed && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono ${
                connected ? "text-green-400" : "text-red-400"
              }`}
            >
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {connected ? "ONLINE" : "OFFLINE"}
            </span>
          )}
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-purple-500/80 text-[10px] font-mono font-bold text-white animate-pulse">
              {activeCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {collapsed && (
            <span className="hidden sm:inline text-[9px] font-mono text-indigo-400/60 border border-indigo-500/20 rounded px-1.5 py-0.5">
              Video from 3 cr
            </span>
          )}
          {collapsed ? (
            <ChevronDown className="w-4 h-4 text-purple-400/60 group-hover:text-purple-300" />
          ) : (
            <ChevronUp className="w-4 h-4 text-purple-400/60 group-hover:text-purple-300" />
          )}
        </div>
      </button>

      {/* Panel body */}
      {!collapsed && (
        <div className="mt-2 p-4 bg-black/40 border border-purple-500/20 rounded-lg space-y-4">
          {/* Promo banner */}
          <div className="flex items-center gap-3 px-3 py-2 bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-purple-500/10 border border-purple-500/20 rounded-lg">
            <div className="flex-1">
              <p className="text-[11px] font-mono font-bold text-purple-200">
                GPU-Powered AI Studio
              </p>
              <p className="text-[9px] font-mono text-purple-400/60 mt-0.5">
                Images from 1 cr &middot; Video from 3 cr &middot; Cheaper than Grok video (5 cr)
              </p>
            </div>
            <div className="shrink-0 px-2 py-1 bg-green-500/10 border border-green-500/20 rounded text-[9px] font-mono font-bold text-green-400">
              SAVE 40%
            </div>
          </div>

          {/* Offline warning */}
          {!connected && (
            <div className="flex items-center justify-between p-3 bg-red-500/10 border border-red-500/30 rounded text-red-300 text-xs font-mono">
              <span>ComfyUI not reachable. Check tunnel & server.</span>
              <button onClick={checkStatus} className="hover:text-red-100 ml-2" title="Retry connection">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Workflow mode toggle */}
          <div className="flex gap-2">
            {(["txt2img", "qwen-edit", "wan-video"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`flex-1 px-3 py-2 rounded text-xs font-mono font-bold uppercase tracking-wider border transition-colors ${
                  workflowMode === m
                    ? m === "wan-video"
                      ? "bg-indigo-600/60 border-indigo-400/60 text-white"
                      : "bg-purple-600/60 border-purple-400/60 text-white"
                    : "bg-black/40 border-purple-500/20 text-purple-400/60 hover:border-purple-400/40"
                }`}
              >
                {m === "txt2img" ? "Txt2Img" : m === "qwen-edit" ? "Qwen Edit" : (
                  <span className="inline-flex items-center gap-1">
                    <Film className="w-3 h-3" />
                    WAN Video
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Image upload (qwen-edit & wan-video) */}
          {needsImage && (
            <div>
              <label className={labelClass}>
                {workflowMode === "wan-video" ? "Start Image" : "Input Image"}
              </label>
              {inputImage ? (
                <div className="relative">
                  <img
                    src={inputImage}
                    alt="Input"
                    className="w-full max-h-48 object-contain rounded border border-cyan-500/20 bg-black/60"
                  />
                  <button
                    onClick={clearImage}
                    className="absolute top-1 right-1 p-1 bg-black/80 rounded-full text-red-400 hover:text-red-300"
                    title="Remove image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="mt-1 text-[10px] font-mono text-cyan-400/50 truncate">
                    {inputImageName}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-6 bg-black/60 border border-dashed border-cyan-500/30 rounded text-sm font-mono text-cyan-400/60 hover:border-cyan-400/50 hover:text-cyan-300 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  {workflowMode === "wan-video"
                    ? "Upload start frame"
                    : "Upload image to edit"}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
            </div>
          )}

          {/* Checkpoint (not for wan-video — uses fixed models) */}
          {needsCheckpoint && (
            <div>
              <label className={labelClass}>Checkpoint</label>
              <select
                value={selectedCkpt}
                onChange={(e) => setSelectedCkpt(e.target.value)}
                className={inputClass}
              >
                {checkpoints.length === 0 && <option value="">No models found</option>}
                {checkpoints.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {/* LoRA (txt2img only) */}
          {workflowMode === "txt2img" && loras.length > 0 && (
            <div className="space-y-2">
              <div>
                <label className={labelClass}>LoRA (optional)</label>
                <select
                  value={selectedLora}
                  onChange={(e) => setSelectedLora(e.target.value)}
                  className={inputClass}
                >
                  <option value="none">None</option>
                  {loras.map((l) => (
                    <option key={l} value={l}>{l.replace(/\.[^.]+$/, "")}</option>
                  ))}
                </select>
              </div>
              {selectedLora !== "none" && (
                <div>
                  <label className={labelClass}>LoRA Strength: {loraStrength.toFixed(2)}</label>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={loraStrength}
                    onChange={(e) => setLoraStrength(Number(e.target.value))}
                    className="w-full accent-purple-500 mt-1"
                  />
                </div>
              )}
            </div>
          )}

          {/* WAN Video fixed model info */}
          {workflowMode === "wan-video" && (
            <div className="px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded text-[10px] font-mono text-indigo-300/70 space-y-1">
              <div>
                <span className="text-indigo-400 font-bold">MODEL:</span> WAN 2.2 I2V 14B fp8 + Lightx2v 4-step LoRA
              </div>
              <div className="text-[9px] text-green-400/70">
                3 credits per video vs 5 cr/5s with Grok Video
              </div>
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className={labelClass}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={
                workflowMode === "wan-video"
                  ? "describe the motion / action for the video..."
                  : workflowMode === "qwen-edit"
                  ? "describe how to edit the image..."
                  : "describe your image..."
              }
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* Negative prompt */}
          <div>
            <label className={labelClass}>Negative Prompt</label>
            <input
              type="text"
              value={negPrompt}
              onChange={(e) => setNegPrompt(e.target.value)}
              placeholder={
                workflowMode === "wan-video"
                  ? "(uses WAN default if empty)"
                  : workflowMode === "qwen-edit"
                  ? "smooth skin, drawn, cgi, fake, cartoon, ugly, disfigured, sfx"
                  : "bad quality, blurry..."
              }
              className={inputClass}
            />
          </div>

          {/* Settings grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={labelClass}>W</label>
              <select
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className={inputClass}
              >
                {sizeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>H</label>
              <select
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className={inputClass}
              >
                {sizeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Steps: {steps}</label>
              <input
                type="range"
                min={1}
                max={workflowMode === "wan-video" ? 10 : 50}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="w-full accent-purple-500 mt-1"
              />
            </div>
            <div>
              <label className={labelClass}>CFG: {cfg}</label>
              <input
                type="range"
                min={1}
                max={15}
                step={0.5}
                value={cfg}
                onChange={(e) => setCfg(Number(e.target.value))}
                className="w-full accent-purple-500 mt-1"
              />
            </div>
          </div>

          {/* WAN Video: frame count */}
          {workflowMode === "wan-video" && (
            <div>
              <label className={labelClass}>
                Frames: {frameCount} (~{(frameCount / (useRife ? 24 : 16)).toFixed(1)}s)
              </label>
              <div className="flex gap-2 flex-wrap">
                {FRAME_PRESETS.map((fp) => (
                  <button
                    key={fp.value}
                    onClick={() => setFrameCount(fp.value)}
                    className={`px-2.5 py-1.5 rounded text-[10px] font-mono border transition-colors ${
                      frameCount === fp.value
                        ? "bg-indigo-600/60 border-indigo-400/60 text-white"
                        : "bg-black/40 border-indigo-500/20 text-indigo-400/60 hover:border-indigo-400/40"
                    }`}
                  >
                    {fp.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Seed */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={labelClass}>Seed</label>
              <input
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="random"
                className={inputClass}
              />
            </div>
            {lastSeed !== null && (
              <button
                onClick={() => setSeed(String(lastSeed))}
                className="shrink-0 px-3 py-2 bg-purple-500/20 border border-purple-500/30 rounded text-xs font-mono text-purple-300 hover:bg-purple-500/30 transition-colors"
                title="Reuse last seed"
              >
                Reuse {lastSeed}
              </button>
            )}
          </div>

          {/* Toggles — context-dependent */}
          <div className="space-y-2.5">
            {/* HD Upscale (qwen-edit) */}
            {workflowMode === "qwen-edit" && (
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={upscale} onChange={(e) => setUpscale(e.target.checked)} className="sr-only peer" />
                <div className={toggleBaseClass} />
                <span className="text-xs font-mono text-cyan-400/70 uppercase tracking-wider">
                  HD Upscale (1.5x, slower)
                </span>
              </label>
            )}

            {/* RIFE interpolation (wan-video) */}
            {workflowMode === "wan-video" && (
              <>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={useRife} onChange={(e) => setUseRife(e.target.checked)} className="sr-only peer" />
                  <div className={toggleBaseClass} />
                  <span className="text-xs font-mono text-cyan-400/70 uppercase tracking-wider">
                    RIFE 2x interpolation (smoother, 24fps)
                  </span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={useVidUpscale} onChange={(e) => setUseVidUpscale(e.target.checked)} className="sr-only peer" />
                  <div className={toggleBaseClass} />
                  <span className="text-xs font-mono text-cyan-400/70 uppercase tracking-wider">
                    2x Lanczos upscale
                  </span>
                </label>
              </>
            )}
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generateDisabled}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 ${
              workflowMode === "wan-video"
                ? "bg-indigo-600/80 hover:bg-indigo-500/80 border-indigo-500/40"
                : "bg-purple-600/80 hover:bg-purple-500/80 border-purple-500/40"
            } disabled:bg-gray-700/50 disabled:text-gray-500 border rounded-lg text-sm font-mono font-bold uppercase tracking-wider text-white transition-colors`}
          >
            {workflowMode === "wan-video" ? <Film className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {activeCount > 0
              ? `${workflowMode === "wan-video" ? "RENDER" : "GENERATE"} (${activeCount} running)`
              : workflowMode === "wan-video"
              ? "RENDER VIDEO"
              : "GENERATE"}
            <span className="text-[10px] opacity-70 ml-1">({currentCost} cr)</span>
          </button>

          {/* ─── Job Queue ─── */}
          {jobs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-purple-400/70 uppercase tracking-wider">
                  Jobs ({jobs.length})
                </span>
                {jobs.some((j) => j.status === "done" || j.status === "error") && (
                  <button
                    onClick={clearFinished}
                    className="flex items-center gap-1 text-[10px] font-mono text-purple-400/50 hover:text-purple-300 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear finished
                  </button>
                )}
              </div>

              <div className="max-h-[600px] overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-purple-500/30">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onDownload={() => handleDownload(job)}
                    onDismiss={() => dismissJob(job.id)}
                    onReuseSeed={() => setSeed(String(job.seed))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Job Card Component ─── */
function JobCard({
  job,
  onDownload,
  onDismiss,
  onReuseSeed,
}: {
  job: ComfyJob;
  onDownload: () => void;
  onDismiss: () => void;
  onReuseSeed: () => void;
}) {
  const isActive = job.status === "submitting" || job.status === "generating";
  const hasResult = !!job.image || !!job.video;

  const statusColor = {
    submitting: "text-yellow-400",
    generating: "text-cyan-400",
    done: "text-green-400",
    error: "text-red-400",
  }[job.status];

  const statusLabel = {
    submitting: "SUBMITTING",
    generating: `GENERATING ${job.elapsed}s`,
    done: `DONE ${job.elapsed}s`,
    error: "ERROR",
  }[job.status];

  const borderColor = {
    submitting: "border-yellow-500/30",
    generating: "border-cyan-500/30",
    done: "border-green-500/30",
    error: "border-red-500/30",
  }[job.status];

  const modeLabel = {
    "txt2img": "TXT2IMG",
    "qwen-edit": "QWEN",
    "wan-video": "WAN-VID",
  }[job.workflowMode];

  return (
    <div className={`p-3 bg-black/50 border ${borderColor} rounded-lg space-y-2`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isActive && (
              <Loader2 className="w-3 h-3 animate-spin text-cyan-400 shrink-0" />
            )}
            <span className={`text-[10px] font-mono font-bold ${statusColor}`}>
              {statusLabel}
            </span>
            <span className={`text-[9px] font-mono uppercase ${
              job.workflowMode === "wan-video" ? "text-indigo-400/50" : "text-purple-400/40"
            }`}>
              {modeLabel}
            </span>
          </div>
          <p className="text-xs font-mono text-cyan-100/60 truncate mt-0.5">
            {job.label}
          </p>
          {job.seed !== null && (
            <button
              onClick={onReuseSeed}
              className="text-[9px] font-mono text-purple-400/40 hover:text-purple-300 transition-colors"
            >
              seed: {job.seed}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasResult && (
            <button
              onClick={onDownload}
              className="p-1.5 text-cyan-400/60 hover:text-cyan-300 transition-colors"
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          {!isActive && (
            <button
              onClick={onDismiss}
              className="p-1.5 text-red-400/40 hover:text-red-300 transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {job.status === "error" && job.error && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-red-300 text-[10px] font-mono break-all">
          {job.error}
        </div>
      )}

      {/* Result: video */}
      {job.video && (
        <video
          src={job.video}
          controls
          autoPlay
          loop
          muted
          playsInline
          className="w-full max-h-[240px] object-contain rounded border border-indigo-500/20 bg-black/80"
        />
      )}

      {/* Result: image */}
      {job.image && !job.video && (
        <img
          src={job.image}
          alt="ComfyUI output"
          className="w-full max-h-[240px] object-contain rounded border border-cyan-500/20 bg-black/80"
        />
      )}
    </div>
  );
}
