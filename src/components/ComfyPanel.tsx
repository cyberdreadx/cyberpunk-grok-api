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
} from "lucide-react";
import { apiFetch } from "@/lib/api";

/* ─── Job types ─── */
interface ComfyJob {
  id: string;
  promptId: string | null;
  status: "submitting" | "generating" | "done" | "error";
  image: string | null;
  error: string | null;
  seed: number | null;
  elapsed: number;
  /** Snapshot of prompt so user can see what each job was */
  label: string;
  workflowMode: "txt2img" | "qwen-edit";
}

const SIZES = [512, 768, 1024, 1080, 1280, 1536, 1920];

export default function ComfyPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [connected, setConnected] = useState(false);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [selectedCkpt, setSelectedCkpt] = useState("");

  // Workflow mode
  type WorkflowMode = "txt2img" | "qwen-edit";
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("qwen-edit");

  // Image upload (for qwen-edit)
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [inputImageName, setInputImageName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1536);
  const [steps, setSteps] = useState(5);
  const [cfg, setCfg] = useState(1);
  const [seed, setSeed] = useState("");
  const [upscale, setUpscale] = useState(false);

  /* ─── Job queue ─── */
  const [jobs, setJobs] = useState<ComfyJob[]>([]);
  const pollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const timerRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const startRefs = useRef<Map<string, number>>(new Map());

  // Derived: any jobs still in progress?
  const activeCount = jobs.filter(
    (j) => j.status === "submitting" || j.status === "generating"
  ).length;

  // Last completed seed (for "reuse seed" button)
  const lastSeed = [...jobs].reverse().find((j) => j.seed !== null)?.seed ?? null;

  /* ─── Cleanup all intervals on unmount ─── */
  useEffect(() => {
    return () => {
      pollRefs.current.forEach((iv) => clearInterval(iv));
      timerRefs.current.forEach((iv) => clearInterval(iv));
    };
  }, []);

  /* ─── Helpers to manage per-job intervals ─── */
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
      await apiFetch("/comfyui", {
        method: "POST",
        body: { action: "status" },
      });
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const data = await apiFetch<{ checkpoints: string[] }>("/comfyui", {
        method: "POST",
        body: { action: "models" },
      });
      setCheckpoints(data.checkpoints || []);
      if (data.checkpoints?.length && !selectedCkpt) {
        setSelectedCkpt(data.checkpoints[0]);
      }
    } catch {
      setCheckpoints([]);
    }
  }, [selectedCkpt]);

  // On expand, load status + models
  useEffect(() => {
    if (!collapsed) {
      checkStatus();
      fetchModels();
    }
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
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const clearImage = () => {
    setInputImage(null);
    setInputImageName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /* ─── Polling for a specific job ─── */
  const startPolling = useCallback(
    (jobId: string, pid: string) => {
      // Clear any existing poll for this job
      const existing = pollRefs.current.get(jobId);
      if (existing) clearInterval(existing);

      const iv = setInterval(async () => {
        try {
          const data = await apiFetch<{
            status: string;
            image?: string;
            error?: string;
          }>("/comfyui", {
            method: "POST",
            body: { action: "poll", promptId: pid },
          });

          if (data.status === "done") {
            clearJobIntervals(jobId);
            updateJob(jobId, { status: "done", image: data.image || null });
          } else if (data.status === "error") {
            clearJobIntervals(jobId);
            updateJob(jobId, {
              status: "error",
              error: data.error || "Generation failed",
            });
          }
        } catch (err: any) {
          clearJobIntervals(jobId);
          updateJob(jobId, {
            status: "error",
            error: err.message || "Poll failed",
          });
        }
      }, 2000);

      pollRefs.current.set(jobId, iv);
    },
    [clearJobIntervals, updateJob]
  );

  /* ─── Generate: creates a new job each time ─── */
  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedCkpt) return;
    if (workflowMode === "qwen-edit" && !inputImage) return;

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label =
      prompt.trim().length > 50
        ? prompt.trim().slice(0, 50) + "…"
        : prompt.trim();

    const newJob: ComfyJob = {
      id: jobId,
      promptId: null,
      status: "submitting",
      image: null,
      error: null,
      seed: null,
      elapsed: 0,
      label,
      workflowMode,
    };

    setJobs((prev) => [newJob, ...prev]);

    // Start per-job elapsed timer
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
      const data = await apiFetch<{ promptId: string; seed: number }>(
        "/comfyui",
        {
          method: "POST",
          body: {
            action: "generate",
            workflow: workflowMode,
            prompt: prompt.trim(),
            negativePrompt: negPrompt.trim() || undefined,
            width,
            height,
            steps,
            cfg,
            seed: seed.trim() ? parseInt(seed, 10) : undefined,
            checkpoint: selectedCkpt,
            imageBase64:
              workflowMode === "qwen-edit" ? inputImage : undefined,
            imageFilename:
              workflowMode === "qwen-edit" ? inputImageName : undefined,
            upscale: upscale || undefined,
          },
        }
      );
      updateJob(jobId, {
        promptId: data.promptId,
        seed: data.seed,
        status: "generating",
      });
      startPolling(jobId, data.promptId);
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
    if (!job.image) return;
    const a = document.createElement("a");
    a.href = job.image;
    a.download = `comfy_${job.seed || "output"}.png`;
    a.click();
  };

  const dismissJob = (jobId: string) => {
    clearJobIntervals(jobId);
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  };

  const clearFinished = () => {
    setJobs((prev) => {
      const keep: ComfyJob[] = [];
      for (const j of prev) {
        if (j.status === "submitting" || j.status === "generating") {
          keep.push(j);
        } else {
          clearJobIntervals(j.id);
        }
      }
      return keep;
    });
  };

  /* ─── Styles ─── */
  const inputClass =
    "w-full bg-black/60 border border-cyan-500/30 rounded px-3 py-2 text-sm font-mono text-cyan-100 placeholder-cyan-800 focus:outline-none focus:border-cyan-400/60";
  const labelClass =
    "block text-[10px] font-mono text-cyan-400/70 mb-1 uppercase tracking-wider";

  return (
    <div className="mb-6">
      {/* Toggle header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-black/60 border border-purple-500/30 rounded-lg hover:border-purple-400/50 transition-colors group"
      >
        <div className="flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-mono font-semibold tracking-wider text-purple-300 uppercase">
            Comfy_Lab
          </span>
          {!collapsed && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono ${
                connected ? "text-green-400" : "text-red-400"
              }`}
            >
              {connected ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {connected ? "ONLINE" : "OFFLINE"}
            </span>
          )}
          {/* Badge: active job count */}
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-purple-500/80 text-[10px] font-mono font-bold text-white animate-pulse">
              {activeCount}
            </span>
          )}
        </div>
        {collapsed ? (
          <ChevronDown className="w-4 h-4 text-purple-400/60 group-hover:text-purple-300" />
        ) : (
          <ChevronUp className="w-4 h-4 text-purple-400/60 group-hover:text-purple-300" />
        )}
      </button>

      {/* Panel body */}
      {!collapsed && (
        <div className="mt-2 p-4 bg-black/40 border border-purple-500/20 rounded-lg space-y-4">
          {/* Offline warning */}
          {!connected && (
            <div className="flex items-center justify-between p-3 bg-red-500/10 border border-red-500/30 rounded text-red-300 text-xs font-mono">
              <span>ComfyUI not reachable. Check tunnel & server.</span>
              <button
                onClick={checkStatus}
                className="hover:text-red-100 ml-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Workflow mode toggle */}
          <div className="flex gap-2">
            {(["txt2img", "qwen-edit"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setWorkflowMode(m);
                  if (m === "qwen-edit") {
                    setSteps(5);
                    setCfg(1);
                    setWidth(1024);
                    setHeight(1536);
                  } else {
                    setSteps(20);
                    setCfg(7);
                    setWidth(1024);
                    setHeight(1024);
                  }
                }}
                className={`flex-1 px-3 py-2 rounded text-xs font-mono font-bold uppercase tracking-wider border transition-colors ${
                  workflowMode === m
                    ? "bg-purple-600/60 border-purple-400/60 text-white"
                    : "bg-black/40 border-purple-500/20 text-purple-400/60 hover:border-purple-400/40"
                }`}
              >
                {m === "txt2img" ? "Text to Image" : "Qwen Edit"}
              </button>
            ))}
          </div>

          {/* Image upload (qwen-edit only) */}
          {workflowMode === "qwen-edit" && (
            <div>
              <label className={labelClass}>Input Image</label>
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
                  Upload image to edit
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

          {/* Checkpoint */}
          <div>
            <label className={labelClass}>Checkpoint</label>
            <select
              value={selectedCkpt}
              onChange={(e) => setSelectedCkpt(e.target.value)}
              className={inputClass}
            >
              {checkpoints.length === 0 && (
                <option value="">No models found</option>
              )}
              {checkpoints.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Prompt */}
          <div>
            <label className={labelClass}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={
                workflowMode === "qwen-edit"
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
                workflowMode === "qwen-edit"
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
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
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
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Steps: {steps}</label>
              <input
                type="range"
                min={1}
                max={50}
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

          {/* Seed */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={labelClass}>Seed</label>
              <input
                type="text"
                value={seed}
                onChange={(e) =>
                  setSeed(e.target.value.replace(/[^0-9]/g, ""))
                }
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

          {/* HD Upscale toggle (qwen-edit only) */}
          {workflowMode === "qwen-edit" && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={upscale}
                onChange={(e) => setUpscale(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-black/60 border border-cyan-500/30 rounded-full peer peer-checked:bg-purple-600/60 peer-checked:border-purple-400/60 relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-gray-400 after:rounded-full after:transition-all peer-checked:after:translate-x-4 peer-checked:after:bg-white" />
              <span className="text-xs font-mono text-cyan-400/70 uppercase tracking-wider">
                HD Upscale (1.5x, slower)
              </span>
            </label>
          )}

          {/* Generate button — ALWAYS enabled (no busy lock) */}
          <button
            onClick={handleGenerate}
            disabled={
              !prompt.trim() ||
              !selectedCkpt ||
              !connected ||
              (workflowMode === "qwen-edit" && !inputImage)
            }
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600/80 hover:bg-purple-500/80 disabled:bg-gray-700/50 disabled:text-gray-500 border border-purple-500/40 rounded-lg text-sm font-mono font-bold uppercase tracking-wider text-white transition-colors"
          >
            <Play className="w-4 h-4" />
            {activeCount > 0
              ? `GENERATE (${activeCount} running)`
              : "GENERATE"}
          </button>

          {/* ─── Job Queue ─── */}
          {jobs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-purple-400/70 uppercase tracking-wider">
                  Jobs ({jobs.length})
                </span>
                {jobs.some(
                  (j) => j.status === "done" || j.status === "error"
                ) && (
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

  return (
    <div
      className={`p-3 bg-black/50 border ${borderColor} rounded-lg space-y-2`}
    >
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
            <span className="text-[9px] font-mono text-purple-400/40 uppercase">
              {job.workflowMode}
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
          {job.image && (
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

      {/* Result image */}
      {job.image && (
        <img
          src={job.image}
          alt="ComfyUI output"
          className="w-full rounded border border-cyan-500/20"
        />
      )}
    </div>
  );
}
