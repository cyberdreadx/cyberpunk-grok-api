import { useState, useCallback, useEffect, useRef, startTransition } from "react";
import {
  saveResult,
  loadResults,
  deleteStoredResult,
  clearStoredResults,
  moveResultToFolder,
  migrateFromLocalStorage,
} from "@/lib/storage";
import { apiFetch, calculateCreditCost, backendEnabled, apiUrl } from "@/lib/api";
import { publishApiMode, subscribeApiMode } from "@/lib/apiModeChannel";

interface ActiveJob {
  promptId: string;
  outputType: string;
  submittedAt: number;
  runpodEndpointId?: string;
  pollEndpoint?: string;
  prompt?: string;
}

function getActiveJobs(): ActiveJob[] {
  try {
    const raw = localStorage.getItem("comfy-active-jobs");
    if (raw) return JSON.parse(raw);
    const legacy = localStorage.getItem("comfy-active-job");
    if (legacy) { localStorage.removeItem("comfy-active-job"); return [JSON.parse(legacy)]; }
  } catch { }
  return [];
}

function saveActiveJob(job: ActiveJob) {
  try {
    const jobs = getActiveJobs().filter(j => j.promptId !== job.promptId);
    jobs.push(job);
    localStorage.setItem("comfy-active-jobs", JSON.stringify(jobs));
  } catch { }
}

function removeActiveJob(promptId: string) {
  try {
    const jobs = getActiveJobs().filter(j => j.promptId !== promptId);
    if (jobs.length) localStorage.setItem("comfy-active-jobs", JSON.stringify(jobs));
    else localStorage.removeItem("comfy-active-jobs");
  } catch { }
}

/** Standalone submit + poll for ComfyUI workflows. Usable outside the hook. */
export async function comfySubmitAndPollStandalone(
  body: Record<string, any>,
  opts: { pollInterval?: number; maxAttempts?: number } = {},
): Promise<{ image?: string; video?: string; previewUrl?: string }> {
  const { pollInterval = 2000, maxAttempts = 300 } = opts;

  const submitData = await apiFetch<{
    promptId: string;
    seed: number;
    outputType?: string;
    runpodEndpointId?: string;
  }>("/comfyui", { method: "POST", body: { action: "generate", ...body } });

  const { promptId, outputType, runpodEndpointId } = submitData;
  const outType = outputType || (body.workflow === "wan-video" || body.workflow === "longlook" ? "video" : "image");

  // NOTE: Do NOT call saveActiveJob here — standalone polls are used by
  // character chat which has its own separate job queue (char-media-jobs).
  // Writing to the shared comfy-active-jobs queue causes character media
  // to leak into the main UI results grid when the user navigates back.

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const pollData = await apiFetch<{
      status: string;
      image?: string;
      video?: string;
      error?: string;
    }>("/comfyui", {
      method: "POST",
      body: { action: "poll", promptId, outputType: outType, ...(runpodEndpointId && { runpodEndpointId }) },
    });

    if (pollData.status === "done") {
      removeActiveJob(promptId);
      return { image: pollData.image, video: pollData.video };
    }
    if (pollData.status === "error") {
      removeActiveJob(promptId);
      throw new Error(pollData.error || "ComfyUI generation failed");
    }
  }

  removeActiveJob(promptId);
  throw new Error("ComfyUI generation timed out");
}

/** Poll an already-submitted ComfyUI job by promptId. Used to resume jobs after navigation. */
export async function comfyPollUntilDone(
  promptId: string,
  outputType: string,
  opts: { runpodEndpointId?: string; pollInterval?: number; maxAttempts?: number } = {},
): Promise<{ image?: string; video?: string; previewUrl?: string }> {
  const { runpodEndpointId, pollInterval = 3000, maxAttempts = 200 } = opts;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));
    const pollData = await apiFetch<{ status: string; image?: string; video?: string; previewUrl?: string; error?: string }>("/comfyui", {
      method: "POST",
      body: { action: "poll", promptId, outputType, ...(runpodEndpointId && { runpodEndpointId }) },
    });
    if (pollData.status === "done") {
      removeActiveJob(promptId);
      return { image: pollData.image, video: pollData.video };
    }
    if (pollData.status === "error") {
      removeActiveJob(promptId);
      throw new Error(pollData.error || "Generation failed");
    }
  }
  removeActiveJob(promptId);
  throw new Error("Generation timed out");
}

export type GrokMode = "text-to-image" | "edit-image" | "text-to-video" | "image-to-video";

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "2:1" | "1:2" | "19.5:9" | "9:19.5" | "20:9" | "9:20" | "auto";
export type VideoAspectRatio = "16:9" | "4:3" | "1:1" | "9:16" | "3:4" | "3:2" | "2:3";
export type VideoResolution = "720p" | "480p";
export type ImageResolution = "1k" | "2k";
export type ImageCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface GenerationSettings {
  aspectRatio: AspectRatio;
  count: ImageCount;
  resolution: ImageResolution;
}

export interface VideoSettings {
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number; // 1–15 seconds
}

export const DEFAULT_SETTINGS: GenerationSettings = {
  aspectRatio: "1:1",
  count: 1,
  resolution: "1k",
};

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: "16:9",
  resolution: "720p",
  duration: 5,
};

export interface GrokResult {
  id: string;
  url: string;
  previewUrl?: string;
  revised_prompt?: string;
  type: "image" | "video";
  timestamp: number;
  folderId?: string | null;
}

export interface VideoLoraEntry {
  name: string;
  displayName?: string;
  high?: string;
  low?: string;
  single?: string;
  nsfw?: boolean;
}

export interface ComfyJob {
  id: string;
  status: "submitting" | "generating" | "done" | "error" | "cancelling";
  workflowType: string;
  prompt: string;
  phase: string | null;
  elapsed: number;
  seed: number | null;
  error: string | null;
  runpodJobId?: string;
}

interface GenerateImageParams {
  prompt: string;
  settings: GenerationSettings;
  pro?: boolean;
  testCredits?: boolean;
}

interface EditImageParams {
  prompt: string;
  image_url: string;
  extra_image_urls?: string[];
  settings: GenerationSettings;
  pro?: boolean;
  testCredits?: boolean;
}

interface GenerateVideoParams {
  prompt: string;
  image_url?: string;
  videoSettings: VideoSettings;
  testCredits?: boolean;
  /** Optional provider override. Routes to fal.ai Seedance tiers via /api/generate proxy. */
  provider?: "grok" | "seedance" | "seedance-fast" | "seedance-pro";
}

/** Generation mode: "byok" = user's own API key, "credits" = server proxy w/ credits */
export type ApiMode = "byok" | "credits";

// NOTE: All xAI API calls go through /api/generate proxy — never directly from the browser.
// Direct calls to api.x.ai are blocked by CORS in browsers.

/** Convert an external URL to a base64 data-URL (used for user-provided URLs).
 *  Large images (4K+) are resized via canvas to avoid 413 payload errors. */
export async function urlToBase64(url: string): Promise<string> {
  if (!url || url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    // Only compress image blobs; pass other types through directly
    if (!blob.type.startsWith("image/")) {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    const MAX_DIM = 4096;
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width, h = bitmap.height;
    // Small images pass through untouched (preserves PNG transparency)
    if (w <= MAX_DIM && h <= MAX_DIM && blob.size < 4 * 1024 * 1024) {
      bitmap.close();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    // Downscale + compress
    if (w > MAX_DIM || h > MAX_DIM) {
      const scale = MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    // Use async toBlob instead of synchronous toDataURL to avoid freezing the UI
    return await new Promise<string>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (!b) return reject(new Error("toBlob failed"));
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(b);
        },
        "image/jpeg",
        0.92,
      );
    });
  } catch {
    // If conversion fails and the original is a blob:/http: URL (not data:),
    // don't return it raw — it would be sent as fake "base64" and corrupt the file.
    if (url.startsWith("blob:") || url.startsWith("http")) {
      throw new Error("Failed to convert image to base64. The image may be expired — please re-upload or re-generate it.");
    }
    return url;
  }
}

/** Read natural dimensions of an image from a data-URL or object URL. */
export function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 1024, height: 1024 });
    img.src = src;
  });
}

/** Make raw API error messages more user-friendly. */
function friendlyError(msg: unknown): string {
  const text = typeof msg === "string" ? msg : (msg == null ? "" : String(msg));
  if (!text) return "Something went wrong. Please try again.";
  const lower = text.toLowerCase();
  if (lower.includes("content moderation") || lower.includes("rejected by content"))
    return "Your prompt was flagged by content moderation. Please try rephrasing it.";
  if (lower.includes("monthly") && lower.includes("limit"))
    return "The AI service is temporarily at capacity. Your credits were not deducted. Please try again in a few minutes.";
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("high demand"))
    return "Too many requests — xAI is rate-limiting. Please wait a moment and try again.";
  if (lower.includes("invalid api key") || lower.includes("unauthorized") || lower.includes("401"))
    return "Invalid API key. Please check your key in Settings.";
  if (lower.includes("insufficient credits"))
    return "Not enough credits. Please purchase more to continue.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "Request timed out. The servers may be busy — please try again.";
  if (lower.includes("network") || lower.includes("failed to fetch"))
    return "Network error. Please check your connection and try again.";
  return text;
}

export function useGrokApi() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GrokResult[]>([]);

  /** Large base64 rows can block the main thread if merged synchronously; schedule as transition. */
  const prependResults = useCallback((items: GrokResult[]) => {
    startTransition(() => {
      setResults((prev) => [...items, ...prev]);
    });
  }, []);

  const [storageReady, setStorageReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Persist apiMode across pages/reloads. We track whether the user made
  // an *explicit* choice so we don't keep overriding them. If they never
  // chose, we follow the BYOK key presence automatically. If they did
  // choose BYOK but later remove their key, we fall back to credits
  // (and clear the explicit flag so adding the key back auto-restores BYOK).
  const [apiMode, setApiModeState] = useState<ApiMode>(() => {
    try {
      const saved = localStorage.getItem("api-mode");
      const explicit = localStorage.getItem("api-mode-explicit") === "1";
      const hasKey = !!localStorage.getItem("xai-api-key");
      if (explicit && (saved === "byok" || saved === "credits")) {
        // Honor explicit choice, but downgrade BYOK→credits if key is gone.
        if (saved === "byok" && !hasKey) return "credits";
        return saved;
      }
      return hasKey ? "byok" : "credits";
    } catch {
      return "credits";
    }
  });
  const setApiMode = useCallback((mode: ApiMode) => {
    setApiModeState(mode);
    try {
      localStorage.setItem("api-mode", mode);
      localStorage.setItem("api-mode-explicit", "1");
    } catch {}
    // Broadcast to other tabs (and sibling hook instances in this tab).
    // Native `storage` events fire automatically in *other* tabs as a
    // fallback when BroadcastChannel is unavailable.
    publishApiMode({ kind: "api-mode", mode });
  }, []);

  useEffect(() => {
    const revalidate = () => {
      try {
        const saved = localStorage.getItem("api-mode");
        const explicit = localStorage.getItem("api-mode-explicit") === "1";
        const hasKey = !!localStorage.getItem("xai-api-key");
        let next: ApiMode;
        if (explicit && (saved === "byok" || saved === "credits")) {
          if (saved === "byok" && !hasKey) {
            // User had explicitly chosen BYOK, but their key is gone.
            // Fall back to credits and clear the explicit flag so that
            // re-adding a key will auto-restore BYOK without requiring
            // them to toggle it again.
            next = "credits";
            localStorage.removeItem("api-mode-explicit");
            localStorage.setItem("api-mode", "credits");
          } else {
            next = saved;
          }
        } else {
          next = hasKey ? "byok" : "credits";
        }
        setApiModeState((cur) => (cur === next ? cur : next));
      } catch {}
    };

    const unsubscribe = subscribeApiMode((msg) => {
      if (msg.kind === "api-mode") {
        // Direct mode change from another tab/component — apply, but still
        // run revalidate so we honour the BYOK-key invariant.
        setApiModeState(msg.mode);
        revalidate();
      } else if (msg.kind === "xai-key") {
        revalidate();
      }
    });

    const onKeyChanged = () => {
      // Same-tab key add/remove via setApiKey/clearApiKey helpers.
      publishApiMode({ kind: "xai-key", hasKey: !!localStorage.getItem("xai-api-key") });
      revalidate();
    };
    window.addEventListener("xai-api-key-changed", onKeyChanged);

    // Run once on mount in case the key changed between initial state
    // computation and effect setup (e.g. another hook instance updated it).
    revalidate();

    return () => {
      unsubscribe();
      window.removeEventListener("xai-api-key-changed", onKeyChanged);
    };
  }, []);
  const revokeAllRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [comfyJobs, setComfyJobs] = useState<ComfyJob[]>([]);
  const comfyJobStarts = useRef<Map<string, number>>(new Map());
  const videoBlobUrls = useRef<Map<string, string>>(new Map());

  // ── Load persisted results from IndexedDB on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Migrate any legacy localStorage data first
      await migrateFromLocalStorage();
      const { results: loaded, revokeAll } = await loadResults();
      if (!cancelled) {
        revokeAllRef.current = revokeAll;
        setResults(loaded);
        setStorageReady(true);
        // Background: localize URL-only library media so cloud copies can be
        // retired without breaking libraries. Delayed to stay off the
        // critical path; self-limiting (migrated items stop qualifying).
        setTimeout(() => {
          import("@/lib/storage").then((m) => m.repersistRemoteResults()).catch(() => {});
        }, 8000);
      } else {
        revokeAll();
      }
    })();
    return () => {
      cancelled = true;
      revokeAllRef.current?.();
      videoBlobUrls.current.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
      videoBlobUrls.current.clear();
    };
  }, []);

  // ── Resume interrupted ComfyUI jobs on mount (supports multiple) ──
  useEffect(() => {
    let cancelled = false;
    const activeJobs = getActiveJobs().filter(j => Date.now() - j.submittedAt < 15 * 60 * 1000);
    if (!activeJobs.length) { localStorage.removeItem("comfy-active-jobs"); localStorage.removeItem("comfy-active-job"); return; }

    const resumeOne = async (saved: ActiveJob) => {
      const jobId = `resume-${saved.promptId}`;
      const resumeJob: ComfyJob = {
        id: jobId, status: "generating",
        workflowType: saved.outputType === "video" ? "wan-video" : "comfy",
        prompt: "Resuming generation...", phase: "Reconnecting to job...",
        elapsed: Math.floor((Date.now() - saved.submittedAt) / 1000),
        seed: null, error: null,
      };
      setComfyJobs(prev => [resumeJob, ...prev]);

      comfyJobStarts.current.set(jobId, saved.submittedAt);

      try {
        for (let i = 0; i < 300; i++) {
          if (cancelled) { comfyJobStarts.current.delete(jobId); return; }
          await new Promise(r => setTimeout(r, 2000));
          const pollPath = saved.pollEndpoint === "gltch" ? "/gltch" : "/comfyui";
          const pollBody = saved.pollEndpoint === "gltch"
            ? { action: "poll", promptId: saved.promptId }
            : { action: "poll", promptId: saved.promptId, outputType: saved.outputType, ...(saved.runpodEndpointId && { runpodEndpointId: saved.runpodEndpointId }) };
          const poll = await apiFetch<{ status: string; image?: string; video?: string; previewUrl?: string; error?: string }>(pollPath, { method: "POST", body: pollBody });

          if (poll.status === "done") {
            comfyJobStarts.current.delete(jobId);
            removeActiveJob(saved.promptId);
            let video = poll.video;
            if (video && video.startsWith("https://") && !video.startsWith("data:")) {
              try {
                const proxyResp = await fetch(apiUrl("/comfyui"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "proxy-s3", url: video }) });
                if (proxyResp.ok) { const blob = await proxyResp.blob(); video = URL.createObjectURL(blob); }
              } catch { }
            }
            const url = video || poll.image || "";
            const resultId = `resume-${Date.now()}-${saved.promptId.slice(0, 8)}`;
            if (video && video.startsWith("blob:")) videoBlobUrls.current.set(resultId, video);
            const newResult: GrokResult = { id: resultId, url, revised_prompt: saved.prompt || "", type: (video ? "video" : "image") as any, timestamp: Date.now() };
            if (!cancelled) {
              prependResults([newResult]);
              try { await saveResult(newResult); } catch { }
              setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
            }
            return;
          }
          if (poll.status === "error") {
            comfyJobStarts.current.delete(jobId);
            removeActiveJob(saved.promptId);
            if (!cancelled) setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "error", error: poll.error || "Generation failed", phase: null } : j));
            return;
          }
        }
        comfyJobStarts.current.delete(jobId);
        removeActiveJob(saved.promptId);
      } catch { comfyJobStarts.current.delete(jobId); removeActiveJob(saved.promptId); }
    };

    activeJobs.forEach(j => resumeOne(j));
    return () => { cancelled = true; };
  }, [prependResults]);

  // ── Warn before closing tab if generations are in progress ──
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const hasActiveComfy = comfyJobs.some(j => j.status === "submitting" || j.status === "generating");
      const hasActiveGrok = isLoading;
      if (hasActiveComfy || hasActiveGrok) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [comfyJobs, isLoading]);

  // ── Timer for video polling elapsed seconds ──
  const startTimer = useCallback(() => {
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedSeconds(0);
  }, []);

  const getApiKey = useCallback((): string | null => {
    return localStorage.getItem("xai-api-key");
  }, []);

  const setApiKey = useCallback((key: string) => {
    localStorage.setItem("xai-api-key", key);
    try { window.dispatchEvent(new Event("xai-api-key-changed")); } catch {}
  }, []);

  const clearApiKey = useCallback(() => {
    localStorage.removeItem("xai-api-key");
    try { window.dispatchEvent(new Event("xai-api-key-changed")); } catch {}
  }, []);

  const hasApiKey = useCallback((): boolean => {
    return !!localStorage.getItem("xai-api-key");
  }, []);

  /**
   * BYOK mode: routes through our /api/generate proxy (passes byokKey server-side)
   * so the browser never calls api.x.ai directly — avoids CORS blocks.
   */
  const makeRequest = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>,
    _method: "POST" | "GET" = "POST",
  ) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API key not configured");

    // Map xAI endpoint path → action name expected by /api/generate
    const endpointActionMap: Record<string, string> = {
      "/images/generations": "generate-image",
      "/images/edits": "edit-image",
      "/videos/generations": "generate-video",
      "/videos/edits": "edit-video",
    };
    const action = endpointActionMap[endpoint];
    if (!action) throw new Error(`Unknown xAI endpoint: ${endpoint}`);

    const data = await apiFetch("/generate", {
      method: "POST",
      body: { action, byokKey: apiKey, ...body },
      auth: false, // no JWT needed for BYOK
    });

    if (data?.error) {
      let msg = typeof data.error === "string" ? data.error : data.error?.message || "Generation failed";
      if (typeof msg === "string" && msg.startsWith("{")) {
        try { const p = JSON.parse(msg); msg = p.error?.message || p.message || msg; } catch { /* keep */ }
      }
      // Detect billing / quota issues and add helpful context
      if (/monthly.*limit|quota.*exceeded/i.test(msg)) {
        msg = "Your xAI account has reached its monthly limit. Add or increase billing at https://console.x.ai";
      } else if (/insufficient|billing|quota|balance|payment/i.test(msg)) {
        msg += "\n\nYour xAI account has no credits. Add billing at https://console.x.ai";
      } else if (/invalid.*key|unauthorized|authentication/i.test(msg)) {
        msg += "\n\nYour API key may be invalid. Check it at https://console.x.ai";
      } else if (/rate.?limit|too many/i.test(msg)) {
        msg += "\n\nRate limit hit. Wait a moment and try again, or add billing at https://console.x.ai";
      }
      throw new Error(msg);
    }

    return data;
  }, [getApiKey]);

  /** Call our Vercel API proxy instead of xAI directly. */
  const makeProxyRequest = useCallback(async (
    action: "generate-image" | "edit-image" | "generate-video",
    params: Record<string, unknown>,
  ) => {
    const data = await apiFetch("/generate", {
      method: "POST",
      body: { action, ...params },
    });
    if (data?.error) {
      let msg = typeof data.error === "string" ? data.error : data.error.message || "Generation failed";
      // Server may pass raw xAI JSON as a string — try to extract the real message
      if (typeof msg === "string" && msg.startsWith("{")) {
        try {
          const parsed = JSON.parse(msg);
          msg = parsed.error?.message || parsed.message || msg;
        } catch { /* keep raw msg */ }
      }
      throw new Error(msg);
    }
    return data;
  }, []);

  // ── Persist a batch of new results to IndexedDB (idle/deferred — never block the UI thread) ──
  const persistNewResults = useCallback((newResults: GrokResult[]) => {
    const run = async () => {
      for (const r of newResults) {
        try { await saveResult(r); } catch { /* best-effort */ }
      }
    };
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => { void run(); }, { timeout: 4000 });
    } else {
      queueMicrotask(() => { void run(); });
    }
  }, []);

  // Text-to-Image
  const generateImage = useCallback(async (params: GenerateImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        model: params.pro ? "grok-imagine-image-pro" : "grok-imagine-image",
        prompt: params.prompt,
        n: params.settings.count,
        aspect_ratio: params.settings.aspectRatio,
        resolution: params.settings.resolution || "1k",
        response_format: "b64_json",
        ...(params.testCredits ? { testCredits: true } : {}),
      };

      let data: any;
      if (apiMode === "credits") {
        data = await makeProxyRequest("generate-image", body);
      } else {
        data = await makeRequest("/images/generations", body);
      }

      const newResults: GrokResult[] = data.data.map((item: any, i: number) => ({
        id: `img-${Date.now()}-${i}`,
        url: item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url,
        revised_prompt: item.revised_prompt,
        type: "image" as const,
        timestamp: Date.now(),
      }));

      prependResults(newResults);
      persistNewResults(newResults);
      return newResults;
    } catch (err: any) {
      setError(friendlyError(err.message));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [apiMode, makeRequest, makeProxyRequest, persistNewResults, prependResults]);

  // Edit Image
  const editImage = useCallback(async (params: EditImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const safeImageUrl = params.image_url.startsWith("data:")
        ? params.image_url
        : await urlToBase64(params.image_url);

      // Build multi-image array if extra images provided
      const hasExtras = params.extra_image_urls && params.extra_image_urls.length > 0;
      let imageField: Record<string, unknown> = {};
      if (hasExtras) {
        const allImages = [safeImageUrl, ...params.extra_image_urls!];
        const imageObjects = await Promise.all(
          allImages.map(async (url) => ({
            url: url.startsWith("data:") ? url : await urlToBase64(url),
            type: "image_url" as const,
          }))
        );
        imageField = { images: imageObjects };
      } else {
        imageField = { image: { url: safeImageUrl } };
      }

      const body: Record<string, unknown> = {
        model: params.pro ? "grok-imagine-image-pro" : "grok-imagine-image",
        prompt: params.prompt,
        ...imageField,
        n: params.settings.count,
        response_format: "b64_json",
        ...(params.testCredits ? { testCredits: true } : {}),
      };

      let data: any;
      if (apiMode === "credits") {
        data = await makeProxyRequest("edit-image", body);
      } else {
        data = await makeRequest("/images/edits", body);
      }

      const newResults: GrokResult[] = data.data.map((item: any, i: number) => ({
        id: `edit-${Date.now()}-${i}`,
        url: item.b64_json
          ? `data:image/png;base64,${item.b64_json}`
          : item.url,
        revised_prompt: item.revised_prompt,
        type: "image" as const,
        timestamp: Date.now(),
      }));

      prependResults(newResults);
      persistNewResults(newResults);
      return newResults;
    } catch (err: any) {
      setError(friendlyError(err.message));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [apiMode, makeRequest, makeProxyRequest, persistNewResults, prependResults]);

  // Edit Image — fire-and-forget with queue (same UX as ComfyUI/GLTCH)
  const grokEditQueued = useCallback((params: EditImageParams) => {
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting",
      workflowType: params.pro ? "grok-edit-pro" : "grok-edit",
      prompt: label, phase: "Editing image...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    comfyJobStarts.current.set(jobId, startTime);

    (async () => {
      try {
        const safeImageUrl = params.image_url.startsWith("data:")
          ? params.image_url
          : await urlToBase64(params.image_url);

        // Build multi-image array if extra images provided
        const hasExtras = params.extra_image_urls && params.extra_image_urls.length > 0;
        let imageField: Record<string, unknown> = {};
        if (hasExtras) {
          const allImages = [safeImageUrl, ...params.extra_image_urls!];
          const imageObjects = await Promise.all(
            allImages.map(async (url) => ({
              url: url.startsWith("data:") ? url : await urlToBase64(url),
              type: "image_url" as const,
            }))
          );
          imageField = { images: imageObjects };
        } else {
          imageField = { image: { url: safeImageUrl } };
        }

        const body: Record<string, unknown> = {
          model: params.pro ? "grok-imagine-image-pro" : "grok-imagine-image",
          prompt: params.prompt,
          ...imageField,
          n: params.settings.count,
          response_format: "b64_json",
          ...(params.testCredits ? { testCredits: true } : {}),
        };

        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));

        let data: any;
        if (apiMode === "credits") {
          data = await makeProxyRequest("edit-image", body);
        } else {
          data = await makeRequest("/images/edits", body);
        }

        comfyJobStarts.current.delete(jobId);

        const newResults: GrokResult[] = data.data.map((item: any, i: number) => ({
          id: `edit-${Date.now()}-${i}`,
          url: item.b64_json
            ? `data:image/png;base64,${item.b64_json}`
            : item.url,
          revised_prompt: item.revised_prompt,
          type: "image" as const,
          timestamp: Date.now(),
        }));

        prependResults(newResults);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        comfyJobStarts.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: friendlyError(err.message), phase: null }
          : j
        ));
      }
    })();
    return jobId;
  }, [apiMode, makeRequest, makeProxyRequest, persistNewResults, prependResults]);

  // Video generation (text-to-video & image-to-video)
  const generateVideo = useCallback(async (params: GenerateVideoParams) => {
    setIsLoading(true);
    setError(null);
    startTimer();
    try {
      const body: Record<string, unknown> = {
        model: "grok-imagine-video",
        prompt: params.prompt,
        duration: params.videoSettings.duration,
        resolution: params.videoSettings.resolution,
        ...(params.testCredits ? { testCredits: true } : {}),
      };

      if (params.image_url) {
        body.image = { url: params.image_url };
        body.image_url = params.image_url; // fal.ai expects image_url
      } else {
        body.aspect_ratio = params.videoSettings.aspectRatio;
      }

      // SEEDANCE provider override → routed to fal.ai via /api/generate proxy.
      // Fast/Pro tiers can take 3–7 min, exceeding Vercel's 300s function limit.
      // Server now returns a job token immediately; we poll /api/seedance-status.
      if (params.provider === "seedance" || params.provider === "seedance-fast" || params.provider === "seedance-pro") {
        const submit = await makeProxyRequest("generate-video", { ...body, provider: params.provider });
        let videoUrl: string | undefined = submit.video?.url || submit.video_url || submit.url;

        if (!videoUrl && submit.async && submit.job_token) {
          const jobToken = submit.job_token as string;
          // Poll up to ~10 min (200 × 3s). Fast=2-4min, Pro=3-7min typical.
          const MAX_ATTEMPTS = 200;
          const INTERVAL_MS = 3000;
          let consecutiveTransient = 0;
          let lastStatus: string | undefined;
          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            await new Promise((r) => setTimeout(r, INTERVAL_MS));
            const poll = await apiFetch("/seedance-status", {
              method: "POST",
              body: { job_token: jobToken },
            });
            if (poll?.error) throw new Error(typeof poll.error === "string" ? poll.error : "SEEDANCE polling failed");
            lastStatus = poll?.status;
            if (poll?.transient) {
              consecutiveTransient++;
              if (attempt % 5 === 0) console.warn("[seedance] transient poll", { attempt, debug: poll?.debug });
              // Fail fast if fal status endpoint is unreachable for ~90s straight
              if (consecutiveTransient >= 30) {
                throw new Error(`SEEDANCE status endpoint unreachable (${poll?.debug || "transient"}).`);
              }
            } else {
              consecutiveTransient = 0;
            }
            if (poll?.status === "COMPLETED") {
              videoUrl = poll.video?.url || poll.video_url;
              if (videoUrl) break;
              // result_pending → keep polling for response_url to settle
            }
            // IN_QUEUE / IN_PROGRESS → continue
          }
          if (!videoUrl) throw new Error(`SEEDANCE generation timed out (last status: ${lastStatus || "unknown"}).`);
        }

        if (!videoUrl) throw new Error("SEEDANCE returned no video URL");
        const newResults: GrokResult[] = [{
          id: `vid-seed-${Date.now()}`,
          url: videoUrl,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        prependResults(newResults);
        persistNewResults(newResults);
        return newResults;
      }


      // Credits mode: the edge function handles submission + polling + deduction
      if (apiMode === "credits") {
        const data = await makeProxyRequest("generate-video", body);
        const videoUrl = data.video?.url || data.video_url || data.url || data.data?.[0]?.url;
        if (!videoUrl) {
          throw new Error("No video URL found in proxy result");
        }
        const newResults: GrokResult[] = [{
          id: `vid-${Date.now()}`,
          url: videoUrl,
          revised_prompt: data.revised_prompt || data.data?.[0]?.revised_prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        prependResults(newResults);
        persistNewResults(newResults);
        return newResults;
      }

      // BYOK mode: proxy handles polling server-side
      const data = await makeRequest("/videos/generations", body);

      const videoUrl = data.video?.url || data.video_url || data.url || data.data?.[0]?.url;
      if (!videoUrl) {
        throw new Error("No video URL found in result. Keys: " + JSON.stringify(Object.keys(data)));
      }

      const newResults: GrokResult[] = [{
        id: `vid-${Date.now()}`,
        url: videoUrl,
        revised_prompt: data.revised_prompt || data.data?.[0]?.revised_prompt,
        type: "video" as const,
        timestamp: Date.now(),
      }];

      prependResults(newResults);
      persistNewResults(newResults);
      return newResults;
    } catch (err: any) {
      setError(friendlyError(err.message));
      throw err;
    } finally {
      setIsLoading(false);
      stopTimer();
    }
  }, [apiMode, makeRequest, makeProxyRequest, persistNewResults, prependResults, startTimer, stopTimer]);

  // GLTCH Edit (Flux 2 Klein via /api/gltch) — fire-and-forget with queue
  const gltchEdit = useCallback((params: {
    prompt: string;
    image_url: string;
    aspectRatio: string;
    hd?: boolean;
    testCredits?: boolean;
  }) => {
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: params.hd ? "gltch-hd" : "gltch",
      prompt: label, phase: "Editing image...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    comfyJobStarts.current.set(jobId, startTime);

    (async () => {
      try {
        const imageBase64 = params.image_url.startsWith("data:")
          ? params.image_url
          : await urlToBase64(params.image_url);

        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));

        const submitData = await apiFetch<{
          promptId: string;
          seed: number;
          syncResult?: { status: string; image?: string; previewUrl?: string; error?: string };
        }>("/gltch", {
          method: "POST",
          body: {
            action: "submit",
            prompt: params.prompt,
            imageBase64,
            aspectRatio: params.aspectRatio,
            hd: params.hd || false,
            ...(params.testCredits ? { testCredits: true } : {}),
          },
        });

        saveActiveJob({ promptId: submitData.promptId, outputType: "image", submittedAt: Date.now(), pollEndpoint: "gltch", prompt: params.prompt });

        // runsync may return result directly
        if (submitData.syncResult?.status === "done" && submitData.syncResult.image) {
          removeActiveJob(submitData.promptId);
          comfyJobStarts.current.delete(jobId);
          const newResults: GrokResult[] = [{
            id: `gltch-${Date.now()}`,
            url: submitData.syncResult.image,
            previewUrl: submitData.syncResult.previewUrl,
            revised_prompt: `GLTCH Edit: ${params.prompt}`,
            type: "image" as const,
            timestamp: Date.now(),
          }];
          prependResults(newResults);
          persistNewResults(newResults);
          setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null, seed: submitData.seed } : j));
          return;
        }

        if (submitData.syncResult?.status === "error") {
          throw new Error(submitData.syncResult.error || "GLTCH edit failed");
        }

        // Fall back to polling
        const maxAttempts = 120;
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const pollData = await apiFetch<{
            status: string;
            image?: string;
            video?: string;
            previewUrl?: string;
            error?: string;
          }>("/gltch", {
            method: "POST",
            body: { action: "poll", promptId: submitData.promptId },
          });

          if (pollData.status === "done" && pollData.image) {
            comfyJobStarts.current.delete(jobId);
            removeActiveJob(submitData.promptId);
            const newResults: GrokResult[] = [{
              id: `gltch-${Date.now()}`,
              url: pollData.image,
              previewUrl: pollData.previewUrl,
              revised_prompt: `GLTCH Edit: ${params.prompt}`,
              type: "image" as const,
              timestamp: Date.now(),
            }];
            prependResults(newResults);
            persistNewResults(newResults);
            setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null, seed: submitData.seed } : j));
            return;
          }

          if (pollData.status === "error") {
            removeActiveJob(submitData.promptId);
            throw new Error(pollData.error || "GLTCH edit failed");
          }
        }

        removeActiveJob(submitData.promptId);
        throw new Error("GLTCH edit timed out after 4 minutes");
      } catch (err: any) {
        comfyJobStarts.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "GLTCH edit failed", phase: null }
          : j
        ));
      }
    })();
    return jobId;
  }, [persistNewResults, prependResults]);

  const clearResults = useCallback(async () => {
    results.forEach(r => { if (r.url?.startsWith("blob:")) try { URL.revokeObjectURL(r.url); } catch {} });
    videoBlobUrls.current.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    videoBlobUrls.current.clear();
    const clearedIds = results.map(r => r.id);
    if (clearedIds.length > 0) {
      import("@/lib/shareLinks").then(({ revokeSharesForResults }) => revokeSharesForResults(clearedIds)).catch(() => {});
    }
    setResults([]);
    revokeAllRef.current?.();
    revokeAllRef.current = null;
    try {
      const { urls } = await clearStoredResults();
      import("@/lib/remotePurge").then(({ purgeRemoteUrls }) => purgeRemoteUrls(urls)).catch(() => {});
    } catch { /* best-effort */ }
  }, [results]);

  const deleteResult = useCallback(async (id: string) => {
    const item = results.find(r => r.id === id);
    if (item?.folderId === "__trash") {
      if (item.url?.startsWith("blob:")) try { URL.revokeObjectURL(item.url); } catch {}
      const tracked = videoBlobUrls.current.get(id);
      if (tracked) { try { URL.revokeObjectURL(tracked); } catch {} videoBlobUrls.current.delete(id); }
      setResults(prev => prev.filter(r => r.id !== id));
      import("@/lib/shareLinks").then(({ revokeSharesForResults }) => revokeSharesForResults([id])).catch(() => {});
      try {
        const { urls } = await deleteStoredResult(id);
        import("@/lib/remotePurge").then(({ purgeRemoteUrls }) => purgeRemoteUrls(urls)).catch(() => {});
      } catch { /* best-effort */ }
    } else {
      setResults(prev => prev.map(r => r.id === id ? { ...r, folderId: "__trash" } : r));
      try { await moveResultToFolder(id, "__trash"); } catch { /* best-effort */ }
    }
  }, [results]);

  /** Update a result's folderId in React state (IndexedDB update is handled separately). */
  const updateResultFolder = useCallback((resultId: string, folderId: string | null) => {
    setResults(prev => prev.map(r => r.id === resultId ? { ...r, folderId } : r));
  }, []);

  /** Add an externally-produced result (e.g. from ComfyUI) to the gallery. */
  const addExternalResult = useCallback(async (result: GrokResult) => {
    prependResults([result]);
    try { await saveResult(result); } catch { /* best-effort */ }
  }, [prependResults]);

  // ── ComfyUI Job Queue ─────────────────────────────────────────────────────

  // Clean up intervals on unmount
  useEffect(() => {
    const iv = setInterval(() => {
      setComfyJobs(prev => {
        if (!comfyJobStarts.current.size) return prev;
        let changed = false;
        const next = prev.map(j => {
          const start = comfyJobStarts.current.get(j.id);
          if (!start || (j.status !== "submitting" && j.status !== "generating")) return j;
          const elapsed = Math.floor((Date.now() - start) / 1000);
          if (elapsed === j.elapsed) return j;
          changed = true;
          return { ...j, elapsed };
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      clearInterval(iv);
      comfyJobStarts.current.clear();
    };
  }, []);

  const comfyPromptIds = useRef<Map<string, string>>(new Map());

  const dismissComfyJob = useCallback((jobId: string) => {
    comfyJobStarts.current.delete(jobId);
    comfyPromptIds.current.delete(jobId);
    setComfyJobs(prev => prev.filter(j => j.id !== jobId));
  }, []);

  const cancelComfyJob = useCallback(async (jobId: string) => {
    const promptId = comfyPromptIds.current.get(jobId);
    if (!promptId) {
      dismissComfyJob(jobId);
      return;
    }
    setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "cancelling" as const, phase: "Cancelling..." } : j));
    try {
      await apiFetch("/comfyui", { method: "POST", body: { action: "cancel", jobId: promptId } });
    } catch { /* best effort */ }
    removeActiveJob(promptId);
    comfyJobStarts.current.delete(jobId);
    comfyPromptIds.current.delete(jobId);
    setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "error" as const, phase: null, error: "Cancelled" } : j));
  }, [dismissComfyJob]);

  const clearFinishedComfyJobs = useCallback(() => {
    setComfyJobs(prev => {
      const removed = prev.filter(j => j.status === "done" || j.status === "error");
      for (const j of removed) {
        comfyJobStarts.current.delete(j.id);
        comfyPromptIds.current.delete(j.id);
      }
      return prev.filter(j => j.status !== "done" && j.status !== "error");
    });
  }, []);

  // ── ComfyUI Functions ────────────────────────────────────────────────────

  // Shared submit + poll helper for ComfyUI workflows
  const comfySubmitAndPoll = useCallback(async (
    body: Record<string, any>,
    opts: { pollInterval?: number; maxAttempts?: number; onPromptId?: (promptId: string) => void } = {},
  ): Promise<{ image?: string; video?: string; previewUrl?: string }> => {
    const { pollInterval = 2000, maxAttempts = 300, onPromptId } = opts;

    const submitData = await apiFetch<{
      promptId: string;
      seed: number;
      outputType?: string;
      runpodEndpointId?: string;
    }>("/comfyui", { method: "POST", body: { action: "generate", ...body } });

    const { promptId, outputType, runpodEndpointId } = submitData;
    onPromptId?.(promptId);
    const VIDEO_WORKFLOWS = new Set(["wan-video", "longlook", "gltch-wan", "ltx-video", "ltx-animate"]);
    const outType = outputType || (VIDEO_WORKFLOWS.has(body.workflow as string) ? "video" : "image");

    saveActiveJob({ promptId, outputType: outType, submittedAt: Date.now(), ...(runpodEndpointId && { runpodEndpointId }), prompt: body.prompt as string || "" });

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const pollData = await apiFetch<{
        status: string;
        image?: string;
        video?: string;
        previewUrl?: string;
        error?: string;
      }>("/comfyui", {
        method: "POST",
        body: { action: "poll", promptId, outputType: outType, ...(runpodEndpointId && { runpodEndpointId }) },
      });

      if (pollData.status === "done") {
        removeActiveJob(promptId);

        // If video is an S3 URL (not base64/data URI), proxy through backend
        let video = pollData.video;
        if (video && video.startsWith("https://") && !video.startsWith("data:")) {
          try {
            console.log("[comfy-poll] Proxying S3 video through backend...");
            const proxyResp = await fetch(apiUrl("/comfyui"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "proxy-s3", url: video }),
            });
            if (proxyResp.ok) {
              const blob = await proxyResp.blob();
              video = URL.createObjectURL(blob);
              console.log(`[comfy-poll] Video proxied: ${Math.round(blob.size / 1024)}KB`);
            } else {
              console.error("[comfy-poll] Video proxy failed, using S3 URL as fallback");
            }
          } catch (proxyErr) {
            console.error("[comfy-poll] Video proxy error:", proxyErr);
          }
        }

        return { image: pollData.image, video, previewUrl: pollData.previewUrl };
      }
      if (pollData.status === "error") {
        removeActiveJob(promptId);
        throw new Error(pollData.error || "ComfyUI generation failed");
      }
    }

    removeActiveJob(promptId);
    throw new Error("ComfyUI generation timed out");
  }, []);

  /** Two-phase status for chained text-to-video */
  const [comfyPhase, setComfyPhase] = useState<string | null>(null);

  /** ComfyUI models + LoRAs (fetched on demand) */
  const [comfyModels, setComfyModels] = useState<{
    checkpoints: string[];
    loras: string[];
    videoLoras: VideoLoraEntry[];
    editLoras: string[];
    xrgeHolder: boolean;
    /** How much the LTX spatial tail multiplies the requested size. 1 when
        it's off, so the size picker can label what actually comes back. */
    ltxUpscaleFactor: number;
  }>({
    checkpoints: [],
    loras: [],
    videoLoras: [],
    editLoras: [],
    xrgeHolder: false,
    ltxUpscaleFactor: 1,
  });

  const fetchComfyModels = useCallback(async () => {
    try {
      const data = await apiFetch<{
        checkpoints: string[];
        loras?: string[];
        videoLoras?: VideoLoraEntry[];
        editLoras?: string[];
        xrgeHolder?: boolean;
        ltxUpscaleFactor?: number;
      }>("/comfyui", {
        method: "POST",
        body: { action: "models" },
      });
      setComfyModels({
        checkpoints: data.checkpoints || [],
        loras: data.loras || [],
        videoLoras: data.videoLoras || [],
        editLoras: data.editLoras || [],
        xrgeHolder: data.xrgeHolder ?? false,
        ltxUpscaleFactor: data.ltxUpscaleFactor ?? 1,
      });
    } catch {
      setComfyModels({ checkpoints: [], loras: [], videoLoras: [], editLoras: [], xrgeHolder: false, ltxUpscaleFactor: 1 });
    }
  }, []);

  // ComfyUI Text-to-Image (fire-and-forget — adds to comfyJobs queue)
  const comfyGenerate = useCallback((params: {
    prompt: string;
    negativePrompt?: string;
    checkpoint?: string;
    lora?: string;
    loraStrength?: number;
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    seed?: number;
    workflow?: string;
    testCredits?: boolean;
  }) => {
    const wfType = params.workflow || "txt2img";
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: wfType,
      prompt: label, phase: "Generating image...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    comfyJobStarts.current.set(jobId, startTime);

    (async () => {
      try {
        const result = await comfySubmitAndPoll({
          workflow: wfType,
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          checkpoint: params.checkpoint,
          lora: params.lora,
          loraStrength: params.loraStrength,
          width: params.width || 1024,
          height: params.height || 1024,
          steps: params.steps || (wfType === "zimage" ? 8 : 5),
          cfg: params.cfg || 1,
          seed: params.seed,
          ...(params.testCredits ? { testCredits: true } : {}),
        }, { onPromptId: (pid) => comfyPromptIds.current.set(jobId, pid) });

        comfyJobStarts.current.delete(jobId);

        if (!result.image) throw new Error("No image returned from ComfyUI");

        const newResults: GrokResult[] = [{
          id: `comfy-img-${Date.now()}`,
          url: result.image,
          previewUrl: result.previewUrl,
          revised_prompt: params.prompt,
          type: "image" as const,
          timestamp: Date.now(),
        }];
        prependResults(newResults);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "Generation failed", phase: null }
          : j
        ));
      }
    })();
    return jobId;
  }, [comfySubmitAndPoll, persistNewResults, prependResults]);

  // ComfyUI Image Edit (fire-and-forget — Flux 2 Klein via `klein` workflow)
  const comfyEdit = useCallback((params: {
    prompt: string;
    imageBase64: string;
    imageFilename?: string;
    imageBase64_2?: string;
    imageFilename2?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    seed?: number;
    loras?: { name: string; strengthModel: number; strengthClip: number }[];
    negativePrompt?: string;
    testCredits?: boolean;
  }) => {
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: "gltch-edit",
      prompt: label, phase: "Editing image...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    comfyJobStarts.current.set(jobId, startTime);

    (async () => {
      try {
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));
        const result = await comfySubmitAndPoll({
          workflow: "klein",
          prompt: params.prompt,
          imageBase64: params.imageBase64,
          imageFilename: params.imageFilename || "input.jpg",
          imageBase64_2: params.imageBase64_2,
          imageFilename2: params.imageFilename2,
          width: params.width || 768,
          height: params.height || 768,
          steps: params.steps || 4,
          cfg: params.cfg || 1,
          seed: params.seed,
          loras: params.loras?.filter(l => l.name !== "none"),
          ...(params.testCredits ? { testCredits: true } : {}),
        }, { onPromptId: (pid) => comfyPromptIds.current.set(jobId, pid) });

        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);

        if (!result.image) throw new Error("No image returned from ComfyUI");

        const newResults: GrokResult[] = [{
          id: `comfy-edit-${Date.now()}`,
          url: result.image,
          previewUrl: result.previewUrl,
          revised_prompt: params.prompt,
          type: "image" as const,
          timestamp: Date.now(),
        }];
        prependResults(newResults);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "Edit failed", phase: null }
          : j
        ));
      }
    })();
    return jobId;
  }, [comfySubmitAndPoll, persistNewResults, prependResults]);

  // ComfyUI Image-to-Video (WAN Video) — fire-and-forget
  const comfyVideo = useCallback((params: {
    prompt: string;
    negativePrompt?: string;
    imageBase64: string;
    imageFilename?: string;
    imageBase64_2?: string;
    imageFilename2?: string;
    width?: number;
    height?: number;
    frameCount?: number;
    steps?: number;
    cfg?: number;
    seed?: number;
    useRife?: boolean;
    useUpscale?: boolean;
    simpleWan?: boolean;
    videoLora?: string;
    videoLoraStrength?: number;
    videoLoraPass?: "high" | "low" | "both";
    workflow?: string;
    resolution?: number;
    shift?: number;
    stage1End?: number;
    stage2End?: number;
    testCredits?: boolean;
    audioMode?: "none" | "ambient";
    audioPrompt?: string;
  }) => {
    const wfType = params.workflow || "wan-video";
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: wfType,
      prompt: label, phase: "Rendering video...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    comfyJobStarts.current.set(jobId, startTime);

    (async () => {
      try {
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));
        const result = await comfySubmitAndPoll({
          workflow: wfType,
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          imageBase64: params.imageBase64,
          imageFilename: params.imageFilename || "input.jpg",
          imageBase64_2: params.imageBase64_2,
          imageFilename2: params.imageFilename2,
          width: params.width || 832,
          height: params.height || 480,
          frameCount: params.frameCount || 81,
          steps: params.steps || 8,
          cfg: params.cfg || 1,
          seed: params.seed,
          useRife: params.useRife ?? true,
          useUpscale: params.useUpscale ?? false,
          simpleWan: params.simpleWan ?? false,
          videoLora: params.videoLora,
          videoLoraStrength: params.videoLoraStrength,
          videoLoraPass: params.videoLoraPass,
          resolution: params.resolution,
          shift: params.shift,
          stage1End: params.stage1End,
          stage2End: params.stage2End,
          audioMode: params.audioMode || "none",
          audioPrompt: params.audioPrompt,
          ...(params.testCredits ? { testCredits: true } : {}),
        }, { pollInterval: 5000, maxAttempts: 120, onPromptId: (pid) => comfyPromptIds.current.set(jobId, pid) });

        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);

        const videoSrc = result.video || result.image;
        if (!videoSrc) throw new Error("No video returned from ComfyUI");

        const rid = `comfy-vid-${Date.now()}`;
        if (videoSrc.startsWith("blob:")) videoBlobUrls.current.set(rid, videoSrc);
        const newResults: GrokResult[] = [{
          id: rid,
          url: videoSrc,
          previewUrl: result.previewUrl,
          revised_prompt: params.prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        prependResults(newResults);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "Render failed", phase: null }
          : j
        ));
      }
    })();
    return jobId;
  }, [comfySubmitAndPoll, persistNewResults, prependResults]);

  // LTX-2.3 video + native audio (text-to-video or image-to-video) — fire-and-forget
  const ltxVideo = useCallback((params: {
    prompt: string;
    negativePrompt?: string;
    imageBase64?: string;     // present → image-to-video (ltx-animate)
    imageFilename?: string;
    width?: number;
    height?: number;
    frameCount?: number;
    frameRate?: number;
    seed?: number;
    audio?: boolean;
    testCredits?: boolean;
  }) => {
    const isI2v = !!params.imageBase64;
    const wfType = isI2v ? "ltx-animate" : "ltx-video";
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: wfType,
      prompt: label, phase: "Rendering LTX video + audio...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    comfyJobStarts.current.set(jobId, startTime);

    (async () => {
      try {
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));
        const result = await comfySubmitAndPoll({
          workflow: wfType,
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          ...(isI2v ? { imageBase64: params.imageBase64, imageFilename: params.imageFilename || "ltx_input.jpg" } : {}),
          width: params.width || 768,
          height: params.height || 512,
          frameCount: params.frameCount || 97,
          frameRate: params.frameRate || 24,
          seed: params.seed,
          ltxAudio: params.audio ?? true,
          ...(params.testCredits ? { testCredits: true } : {}),
        }, { pollInterval: 5000, maxAttempts: 180, onPromptId: (pid) => comfyPromptIds.current.set(jobId, pid) });

        comfyJobStarts.current.delete(jobId);

        const videoSrc = result.video || result.image;
        if (!videoSrc) throw new Error("No video returned from LTX");

        const rid = `ltx-vid-${Date.now()}`;
        if (videoSrc.startsWith("blob:")) videoBlobUrls.current.set(rid, videoSrc);
        const newResults: GrokResult[] = [{
          id: rid,
          url: videoSrc,
          previewUrl: result.previewUrl,
          revised_prompt: params.prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        prependResults(newResults);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        comfyJobStarts.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "LTX render failed", phase: null }
          : j
        ));
      }
    })();
    return jobId;
  }, [comfySubmitAndPoll, persistNewResults, prependResults]);

  // ComfyUI Chained Text-to-Video (zimage → gltch-wan) — fire-and-forget
  const comfyTextToVideo = useCallback((params: {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    frameCount?: number;
    resolution?: number;
    shift?: number;
    useRife?: boolean;
    useUpscale?: boolean;
    simpleWan?: boolean;
    videoLora?: string;
    videoLoraStrength?: number;
    videoLoraPass?: "high" | "low" | "both";
    audioMode?: "none" | "ambient";
    audioPrompt?: string;
    testCredits?: boolean;
  }) => {
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: "txt2video",
      prompt: label, phase: "Generating start frame (Z-Image Turbo)...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    comfyJobStarts.current.set(jobId, startTime);

    (async () => {
      try {
        // Phase 1: Generate start frame via Z-Image Turbo (skipCredits — video step pays for both)
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "generating", phase: "Generating start frame (Z-Image Turbo)..." }
          : j
        ));
        const imgResult = await comfySubmitAndPoll({
          workflow: "zimage",
          prompt: params.prompt,
          width: params.width || 832,
          height: params.height || 480,
          steps: 8,
          cfg: 1,
          skipCredits: true,
        }, { onPromptId: (pid) => comfyPromptIds.current.set(jobId, pid) });

        if (!imgResult.image) throw new Error("Failed to generate start frame");

        // Phase 2: Animate with GLTCH WAN I2V
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, phase: "Rendering video (WAN 2.2 stable mode)..." }
          : j
        ));
        const vidResult = await comfySubmitAndPoll({
          workflow: "gltch-wan",
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          imageBase64: imgResult.image,
          imageFilename: "start_frame.png",
          width: params.width || 832,
          height: params.height || 480,
          frameCount: params.frameCount || 81,
          steps: params.steps || 4,
          cfg: params.cfg || 1,
          resolution: params.resolution || 832,
          shift: params.shift,
          useRife: params.useRife ?? true,
          useUpscale: params.useUpscale ?? false,
          simpleWan: params.simpleWan ?? false,
          videoLora: params.videoLora,
          videoLoraStrength: params.videoLoraStrength,
          videoLoraPass: params.videoLoraPass,
          audioMode: params.audioMode,
          audioPrompt: params.audioPrompt,
          ...(params.testCredits ? { testCredits: true } : {}),
        }, { pollInterval: 5000, maxAttempts: 120, onPromptId: (pid) => comfyPromptIds.current.set(jobId, pid) });

        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);

        const videoSrc = vidResult.video || vidResult.image;
        if (!videoSrc) throw new Error("No video returned from ComfyUI");

        const rid = `comfy-t2v-${Date.now()}`;
        if (videoSrc.startsWith("blob:")) videoBlobUrls.current.set(rid, videoSrc);
        const newResults: GrokResult[] = [{
          id: rid,
          url: videoSrc,
          previewUrl: vidResult.previewUrl,
          revised_prompt: params.prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        prependResults(newResults);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "Text-to-video render failed", phase: null }
          : j
        ));
      }
    })();
    return jobId;
  }, [comfySubmitAndPoll, persistNewResults, prependResults]);

  // ComfyUI LongLook Multi-Clip Video — fire-and-forget
  const comfyLongLook = useCallback((params: {
    prompt: string;
    negativePrompt?: string;
    imageBase64: string;
    width?: number;
    height?: number;
    sequenceCount?: number;
    frameCount?: number;
    steps?: number;
    cfg?: number;
    seed?: number;
    motionScale?: number;
    useRife?: boolean;
    useUpscale?: boolean;
    videoLora?: string;
    videoLoraStrength?: number;
    videoLoraPass?: "high" | "low" | "both";
    testCredits?: boolean;
    audioMode?: "none" | "ambient";
    audioPrompt?: string;
  }) => {
    const seqCount = Math.min(4, Math.max(1, params.sequenceCount ?? 2));
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: "longlook",
      prompt: label, phase: `Rendering ${seqCount} sequences...`, elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    comfyJobStarts.current.set(jobId, startTime);

    (async () => {
      try {
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));
        const result = await comfySubmitAndPoll({
          workflow: "longlook",
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          imageBase64: params.imageBase64,
          imageFilename: "input_longlook.jpg",
          width: params.width || 832,
          height: params.height || 480,
          sequenceCount: seqCount,
          frameCount: params.frameCount || 81,
          steps: params.steps || 8,
          cfg: params.cfg || 1,
          seed: params.seed,
          motionScale: params.motionScale ?? 1.5,
          useRife: params.useRife ?? true,
          useUpscale: params.useUpscale ?? false,
          videoLora: params.videoLora,
          videoLoraStrength: params.videoLoraStrength,
          videoLoraPass: params.videoLoraPass,
          audioMode: params.audioMode || "none",
          audioPrompt: params.audioPrompt,
          ...(params.testCredits ? { testCredits: true } : {}),
        }, { pollInterval: 5000, maxAttempts: 240, onPromptId: (pid) => comfyPromptIds.current.set(jobId, pid) });

        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);

        const videoSrc = result.video || result.image;
        if (!videoSrc) throw new Error("No video returned from ComfyUI");

        const rid = `comfy-ll-${Date.now()}`;
        if (videoSrc.startsWith("blob:")) videoBlobUrls.current.set(rid, videoSrc);
        const newResults: GrokResult[] = [{
          id: rid,
          url: videoSrc,
          previewUrl: result.previewUrl,
          revised_prompt: params.prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        prependResults(newResults);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        comfyJobStarts.current.delete(jobId);
        comfyJobStarts.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "LongLook render failed", phase: null }
          : j
        ));
      }
    })();
    return jobId;
  }, [comfySubmitAndPoll, persistNewResults, prependResults]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isLoading,
    error,
    results,
    elapsedSeconds,
    storageReady,
    apiMode,
    setApiMode,
    getApiKey,
    setApiKey,
    clearApiKey,
    hasApiKey,
    generateImage,
    editImage,
    grokEditQueued,
    generateVideo,
    gltchEdit,
    comfyGenerate,
    comfyEdit,
    comfyVideo,
    comfyTextToVideo,
    ltxVideo,
    comfyLongLook,
    comfyPhase,
    comfyJobs,
    dismissComfyJob,
    cancelComfyJob,
    clearFinishedComfyJobs,
    comfyModels,
    fetchComfyModels,
    clearResults,
    deleteResult,
    updateResultFolder,
    addExternalResult,
    clearError,
    calculateCreditCost,
  };
}
