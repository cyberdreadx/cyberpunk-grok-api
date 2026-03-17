import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Cpu,
  Wifi,
  WifiOff,
  Play,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  X,
  Trash2,
} from "lucide-react";
import { apiFetch, CREDIT_COSTS } from "@/lib/api";
import type { GrokResult } from "@/hooks/useGrokApi";

/* ─── Job types ─── */
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
  outputType: "image" | "video";
}

const SIZES = [512, 768, 1024, 1080, 1280, 1536, 1920];

/* ─── Persistent job storage (survives page close / refresh) ─── */
const PENDING_JOBS_KEY = "comfy-pending-jobs";
const JOB_MAX_AGE_MS = 30 * 60 * 1000; // 30 min — RunPod jobs expire after this

function savePendingJobs(jobs: { promptId: string; outputType: string; label: string; submittedAt: number; runpodEndpointId?: string }[]) {
  try { localStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(jobs)); } catch { /* best-effort */ }
}
function loadPendingJobs(): { promptId: string; outputType: string; label: string; submittedAt: number; runpodEndpointId?: string }[] {
  try {
    const raw = localStorage.getItem(PENDING_JOBS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((j: any) => Date.now() - j.submittedAt < JOB_MAX_AGE_MS) : [];
  } catch { return []; }
}

export default function ComfyPanel({
  connected,
  checkStatus,
  fetchModels,
  checkpoints,
  loras,
  onNewResults,
}: {
  connected: boolean;
  checkStatus: () => void;
  fetchModels: () => void;
  checkpoints: string[];
  loras: string[];
  onNewResults: (results: GrokResult[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  // Image upload
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [inputImageName, setInputImageName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Optional second image
  const [inputImage2, setInputImage2] = useState<string | null>(null);
  const [inputImageName2, setInputImageName2] = useState("");
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  // Params
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [width, setWidth] = useState(768);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(4);
  const [cfg, setCfg] = useState(1);
  const [seed, setSeed] = useState("");
  const [upscale, setUpscale] = useState(false);

  /* ─── Job queue ─── */
  const [jobs, setJobs] = useState<ComfyJob[]>([]);
  const pollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const timerRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const startRefs = useRef<Map<string, number>>(new Map());
  const doneRefs = useRef<Set<string>>(new Set());

  const activeCount = jobs.filter(
    (j) => j.status === "submitting" || j.status === "generating"
  ).length;

  const lastSeed = [...jobs].reverse().find((j) => j.seed !== null)?.seed ?? null;

  /* ─── Cleanup all intervals on unmount ─── */
  useEffect(() => {
    return () => {
      pollRefs.current.forEach((iv) => clearInterval(iv));
      timerRefs.current.forEach((iv) => clearInterval(iv));
    };
  }, []);

  /* ─── Resume pending jobs on mount ─── */
  useEffect(() => {
    if (collapsed) return;
    const pending = loadPendingJobs();
    if (pending.length === 0) return;
    pending.forEach((pj) => {
      if (jobs.some((j) => j.promptId === pj.promptId)) return;
      const jobId = `resume-${pj.promptId}`;
      const outType = (pj.outputType || "image") as "image" | "video";
      setJobs((prev) => [
        {
          id: jobId,
          promptId: pj.promptId,
          status: "generating",
          image: null,
          video: null,
          error: null,
          seed: null,
          elapsed: Math.floor((Date.now() - pj.submittedAt) / 1000),
          label: pj.label || "Resumed job",
          outputType: outType,
        },
        ...prev,
      ]);
      startRefs.current.set(jobId, pj.submittedAt);
      const timerIv = setInterval(() => {
        const start = startRefs.current.get(jobId);
        if (start) {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId ? { ...j, elapsed: Math.floor((Date.now() - start) / 1000) } : j
            )
          );
        }
      }, 1000);
      timerRefs.current.set(jobId, timerIv);
      startPolling(jobId, pj.promptId, outType, pj.label || "Resumed job", pj.runpodEndpointId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

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
    clearImage2();
  };

  const handleImageSelect2 = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        setInputImage2(jpeg);
        setInputImageName2(`${baseName}.jpg`);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
  };

  const clearImage2 = () => {
    setInputImage2(null);
    setInputImageName2("");
    if (fileInputRef2.current) fileInputRef2.current.value = "";
  };

  /* ─── Polling for a specific job ─── */
  const startPolling = useCallback(
    (jobId: string, pid: string, outType: "image" | "video", promptText: string, runpodEndpointId?: string) => {
      let attempts = 0;
      const maxAttempts = 300;
      const iv = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(iv);
          pollRefs.current.delete(jobId);
          const timerIv = timerRefs.current.get(jobId);
          if (timerIv) { clearInterval(timerIv); timerRefs.current.delete(jobId); }
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId ? { ...j, status: "error", error: "Timed out waiting for result." } : j
            )
          );
          return;
        }
        try {
          const data = await apiFetch<{
            status: string;
            image?: string;
            video?: string;
            seed?: number;
            error?: string;
          }>("/comfyui", {
            method: "POST",
            body: { action: "poll", promptId: pid, outputType: outType, ...(runpodEndpointId && { runpodEndpointId }) },
          });

          if (data.status === "done") {
            if (doneRefs.current.has(jobId)) return;
            doneRefs.current.add(jobId);
            clearInterval(iv);
            pollRefs.current.delete(jobId);
            const timerIv = timerRefs.current.get(jobId);
            if (timerIv) { clearInterval(timerIv); timerRefs.current.delete(jobId); }

            setJobs((prev) =>
              prev.map((j) =>
                j.id === jobId
                  ? { ...j, status: "done", image: data.image || null, video: data.video || null, seed: data.seed ?? null }
                  : j
              )
            );

            const pending = loadPendingJobs().filter((p) => p.promptId !== pid);
            savePendingJobs(pending);

            const newResults: GrokResult[] = [];
            if (data.image) {
              newResults.push({
                id: `comfy-${Date.now()}`,
                url: data.image,
                revised_prompt: promptText,
                type: "image",
                timestamp: Date.now(),
              });
            }
            if (data.video) {
              newResults.push({
                id: `comfy-vid-${Date.now()}`,
                url: data.video,
                revised_prompt: promptText,
                type: "video",
                timestamp: Date.now(),
              });
            }
            if (newResults.length > 0) onNewResults(newResults);
          } else if (data.status === "error" || data.status === "FAILED") {
            clearInterval(iv);
            pollRefs.current.delete(jobId);
            const timerIv = timerRefs.current.get(jobId);
            if (timerIv) { clearInterval(timerIv); timerRefs.current.delete(jobId); }

            const pending = loadPendingJobs().filter((p) => p.promptId !== pid);
            savePendingJobs(pending);

            setJobs((prev) =>
              prev.map((j) =>
                j.id === jobId ? { ...j, status: "error", error: data.error || "Generation failed" } : j
              )
            );
          }
        } catch { /* network hiccup — keep polling */ }
      }, 2000);
      pollRefs.current.set(jobId, iv);
    },
    [onNewResults]
  );

  /* ─── Generate handler ─── */
  const handleGenerate = async () => {
    if (!prompt.trim() || !connected || !inputImage) return;

    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = prompt.trim().length > 60 ? prompt.trim().slice(0, 60) + "…" : prompt.trim();

    setJobs((prev) => [
      {
        id: jobId,
        promptId: null,
        status: "submitting",
        image: null,
        video: null,
        error: null,
        seed: null,
        elapsed: 0,
        label,
        outputType: "image",
      },
      ...prev,
    ]);

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
        workflow: "qwen-edit",
        prompt: prompt.trim(),
        negativePrompt: negPrompt.trim() || undefined,
        width,
        height,
        steps,
        cfg,
        seed: seed.trim() ? parseInt(seed, 10) : undefined,
        imageBase64: inputImage,
        imageFilename: inputImageName,
        upscale: upscale || undefined,
      };

      if (inputImage2) {
        body.imageBase64_2 = inputImage2;
        body.imageFilename2 = inputImageName2;
      }

      const data = await apiFetch<{ promptId: string; seed: number; outputType?: string; runpodEndpointId?: string }>("/comfyui", {
        method: "POST",
        body,
      });

      const outType = (data.outputType || "image") as "image" | "video";

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: "generating", promptId: data.promptId, seed: data.seed, outputType: outType }
            : j
        )
      );

      const pending = loadPendingJobs();
      pending.push({
        promptId: data.promptId,
        outputType: outType,
        label,
        submittedAt: Date.now(),
        ...(data.runpodEndpointId && { runpodEndpointId: data.runpodEndpointId }),
      });
      savePendingJobs(pending);

      startPolling(jobId, data.promptId, outType, prompt.trim(), data.runpodEndpointId);
    } catch (err: any) {
      clearInterval(timerIv);
      timerRefs.current.delete(jobId);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: "error", error: err?.message || "Failed to submit" } : j
        )
      );
    }
  };

  /* ─── Job actions ─── */
  const handleDownload = (job: ComfyJob) => {
    const url = job.video || job.image;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = job.video ? `comfy-video-${Date.now()}.mp4` : `comfy-image-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const dismissJob = (id: string) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job?.promptId) {
        const pending = loadPendingJobs().filter((p) => p.promptId !== job.promptId);
        savePendingJobs(pending);
      }
      const keep = prev.filter((j) => j.id !== id);
      const iv = pollRefs.current.get(id);
      if (iv) { clearInterval(iv); pollRefs.current.delete(id); }
      const tiv = timerRefs.current.get(id);
      if (tiv) { clearInterval(tiv); timerRefs.current.delete(id); }
      return keep;
    });
  };

  const clearFinished = () => {
    setJobs((prev) => {
      const keep = prev.filter((j) => j.status === "submitting" || j.status === "generating");
      const pendingIds = new Set(keep.map((j) => j.promptId).filter(Boolean));
      const stored = loadPendingJobs().filter((p) => pendingIds.has(p.promptId));
      savePendingJobs(stored);
      return keep;
    });
  };

  /* ─── Credit cost ─── */
  const currentCost = upscale ? CREDIT_COSTS.comfyEditHd : CREDIT_COSTS.comfyEdit;

  /* ─── Styles ─── */
  const inputClass =
    "w-full bg-black/60 border border-cyan-500/30 rounded px-3 py-2 text-sm font-mono text-cyan-100 placeholder-cyan-800 focus:outline-none focus:border-cyan-400/60";
  const labelClass =
    "block text-[10px] font-mono text-cyan-400/70 mb-1 uppercase tracking-wider";
  const toggleBaseClass =
    "w-9 h-5 bg-black/60 border border-cyan-500/30 rounded-full peer peer-checked:bg-purple-600/60 peer-checked:border-purple-400/60 relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-gray-400 after:rounded-full after:transition-all peer-checked:after:translate-x-4 peer-checked:after:bg-white";

  const generateDisabled = !prompt.trim() || !connected || !inputImage;

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
            GLTCH Edit
          </span>
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
              <button onClick={checkStatus} className="hover:text-red-100 ml-2" title="Retry connection">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Image upload */}
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

          {/* Optional second image */}
          {inputImage && (
            <div>
              <label className={labelClass}>Second Image (optional)</label>
              {inputImage2 ? (
                <div className="relative">
                  <img
                    src={inputImage2}
                    alt="Input 2"
                    className="w-full max-h-48 object-contain rounded border border-cyan-500/20 bg-black/60"
                  />
                  <button
                    onClick={clearImage2}
                    className="absolute top-1 right-1 p-1 bg-black/80 rounded-full text-red-400 hover:text-red-300"
                    title="Remove second image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="mt-1 text-[10px] font-mono text-cyan-400/50 truncate">
                    {inputImageName2}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef2.current?.click()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-3 bg-black/60 border border-dashed border-purple-500/30 rounded text-xs font-mono text-purple-400/60 hover:border-purple-400/50 hover:text-purple-300 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Add second reference image
                </button>
              )}
              <input
                ref={fileInputRef2}
                type="file"
                accept="image/*"
                onChange={handleImageSelect2}
                className="hidden"
              />
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className={labelClass}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="describe how to edit the image..."
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
              placeholder="smooth skin, drawn, cgi, fake, cartoon, ugly, disfigured, sfx"
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
                {SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
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

          {/* HD Upscale toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={upscale} onChange={(e) => setUpscale(e.target.checked)} className="sr-only peer" />
            <div className={toggleBaseClass} />
            <span className="text-xs font-mono text-cyan-400/70 uppercase tracking-wider">
              HD Upscale (1.5x, slower)
            </span>
          </label>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generateDisabled}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600/80 hover:bg-purple-500/80 border-purple-500/40 disabled:bg-gray-700/50 disabled:text-gray-500 border rounded-lg text-sm font-mono font-bold uppercase tracking-wider text-white transition-colors"
          >
            <Play className="w-4 h-4" />
            {activeCount > 0 ? `GENERATE (${activeCount} running)` : "GENERATE"}
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

  return (
    <div className={`p-3 bg-black/50 border ${borderColor} rounded-lg space-y-2`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isActive && (
              <div className="w-3 h-3 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin shrink-0" />
            )}
            <span className={`text-[10px] font-mono font-bold ${statusColor}`}>
              {statusLabel}
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

      {/* Result: image */}
      {job.image && (
        <img
          src={job.image}
          alt="Output"
          className="w-full max-h-[240px] object-contain rounded border border-cyan-500/20 bg-black/80"
        />
      )}
    </div>
  );
}
