import { useState, useCallback, useEffect, useRef } from "react";
import {
  saveResult,
  loadResults,
  deleteStoredResult,
  clearStoredResults,
  migrateFromLocalStorage,
} from "@/lib/storage";
import { apiFetch, calculateCreditCost, backendEnabled } from "@/lib/api";

export type GrokMode = "text-to-image" | "edit-image" | "text-to-video" | "image-to-video" | "edit-video";

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "2:1" | "1:2";
export type VideoAspectRatio = "16:9" | "4:3" | "1:1" | "9:16" | "3:4" | "3:2" | "2:3";
export type VideoResolution = "720p" | "480p";
export type ImageCount = 1 | 2 | 3 | 4;

export interface GenerationSettings {
  aspectRatio: AspectRatio;
  count: ImageCount;
}

export interface VideoSettings {
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number; // 1–15 seconds
}

export const DEFAULT_SETTINGS: GenerationSettings = {
  aspectRatio: "1:1",
  count: 1,
};

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: "16:9",
  resolution: "720p",
  duration: 5,
};

export interface GrokResult {
  id: string;
  url: string;
  revised_prompt?: string;
  type: "image" | "video";
  timestamp: number;
  folderId?: string | null;
}

export interface VideoLoraEntry {
  name: string;
  high?: string;
  low?: string;
  single?: string;
  nsfw?: boolean;
}

export interface ComfyJob {
  id: string;
  status: "submitting" | "generating" | "done" | "error";
  workflowType: string;
  prompt: string;
  phase: string | null;
  elapsed: number;
  seed: number | null;
  error: string | null;
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
  settings: GenerationSettings;
  pro?: boolean;
  testCredits?: boolean;
}

interface GenerateVideoParams {
  prompt: string;
  image_url?: string;
  videoSettings: VideoSettings;
  testCredits?: boolean;
}

interface EditVideoParams {
  prompt: string;
  video_url: string;
  testCredits?: boolean;
}

/** Generation mode: "byok" = user's own API key, "credits" = server proxy w/ credits */
export type ApiMode = "byok" | "credits";

const API_BASE = "https://api.x.ai/v1";

/** Convert an external URL to a base64 data-URL (used for user-provided URLs). */
export async function urlToBase64(url: string): Promise<string> {
  if (!url || url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
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
function friendlyError(msg: string): string {
  const lower = msg.toLowerCase();
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
  return msg;
}

export function useGrokApi() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GrokResult[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [apiMode, setApiMode] = useState<ApiMode>("byok");
  const revokeAllRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      } else {
        revokeAll();
      }
    })();
    return () => {
      cancelled = true;
      revokeAllRef.current?.();
    };
  }, []);

  // ── Resume interrupted ComfyUI jobs on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem("comfy-active-job");
        if (!raw) return;
        const saved = JSON.parse(raw) as {
          promptId: string;
          outputType: string;
          submittedAt: number;
          runpodEndpointId?: string;
          pollEndpoint?: string;
        };
        if (Date.now() - saved.submittedAt > 15 * 60 * 1000) {
          localStorage.removeItem("comfy-active-job");
          return;
        }

        const resumeJob: ComfyJob = {
          id: `resume-${saved.promptId}`,
          status: "generating",
          workflowType: saved.outputType === "video" ? "wan-video" : "comfy",
          prompt: "Resuming generation...",
          phase: "Reconnecting to job...",
          elapsed: Math.floor((Date.now() - saved.submittedAt) / 1000),
          seed: null,
          error: null,
        };
        setComfyJobs(prev => [resumeJob, ...prev]);

        const timerIv = setInterval(() => {
          if (cancelled) return;
          setComfyJobs(prev => prev.map(j =>
            j.id === resumeJob.id && j.status === "generating"
              ? { ...j, elapsed: Math.floor((Date.now() - saved.submittedAt) / 1000) }
              : j
          ));
        }, 1000);

        for (let i = 0; i < 300; i++) {
          if (cancelled) { clearInterval(timerIv); return; }
          await new Promise(r => setTimeout(r, 2000));
          const pollPath = saved.pollEndpoint === "gltch" ? "/gltch" : "/comfyui";
          const pollBody = saved.pollEndpoint === "gltch"
            ? { action: "poll", promptId: saved.promptId }
            : {
                action: "poll",
                promptId: saved.promptId,
                outputType: saved.outputType,
                ...(saved.runpodEndpointId && { runpodEndpointId: saved.runpodEndpointId }),
              };
          const poll = await apiFetch<{ status: string; image?: string; video?: string; error?: string }>(pollPath, {
            method: "POST",
            body: pollBody,
          });
          if (poll.status === "done") {
            clearInterval(timerIv);
            localStorage.removeItem("comfy-active-job");

            let video = poll.video;
            if (video && video.startsWith("https://") && !video.startsWith("data:")) {
              try {
                const proxyResp = await fetch("/api/comfyui", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "proxy-s3", url: video }),
                });
                if (proxyResp.ok) {
                  const blob = await proxyResp.blob();
                  video = URL.createObjectURL(blob);
                }
              } catch { /* use original URL */ }
            }

            const resultType = video ? "video" : "image";
            const url = video || poll.image || "";
            const newResult: GrokResult = {
              id: `resume-${Date.now()}`,
              url,
              type: resultType as any,
              timestamp: Date.now(),
            };
            if (!cancelled) {
              setResults(prev => [newResult, ...prev]);
              try { await saveResult(newResult); } catch { /* best effort */ }
              setComfyJobs(prev => prev.map(j =>
                j.id === resumeJob.id ? { ...j, status: "done", phase: null } : j
              ));
            }
            return;
          }
          if (poll.status === "error") {
            clearInterval(timerIv);
            localStorage.removeItem("comfy-active-job");
            if (!cancelled) {
              setComfyJobs(prev => prev.map(j =>
                j.id === resumeJob.id ? { ...j, status: "error", error: poll.error || "Generation failed", phase: null } : j
              ));
            }
            return;
          }
        }
        clearInterval(timerIv);
        localStorage.removeItem("comfy-active-job");
      } catch { localStorage.removeItem("comfy-active-job"); }
    })();
    return () => { cancelled = true; };
  }, []);

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
  }, []);

  const clearApiKey = useCallback(() => {
    localStorage.removeItem("xai-api-key");
  }, []);

  const hasApiKey = useCallback((): boolean => {
    return !!localStorage.getItem("xai-api-key");
  }, []);

  const makeRequest = useCallback(async (endpoint: string, body: Record<string, unknown>, method: "POST" | "GET" = "POST") => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API key not configured");

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

    if (method === "POST") {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, options);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      let msg = `xAI API error (${response.status})`;
      try {
        const errorData = JSON.parse(errorText);
        msg = errorData.error?.message || errorData.message || errorData.error || msg;
      } catch {
        if (errorText) msg = errorText.slice(0, 300);
      }

      // Detect billing / quota issues and add helpful context
      if (/monthly.*limit|quota.*exceeded/i.test(msg)) {
        msg = "Your xAI account has reached its monthly limit. Add or increase billing at https://console.x.ai";
      } else if (response.status === 402 || response.status === 403 || /insufficient|billing|quota|balance|payment/i.test(msg)) {
        msg += "\n\nYour xAI account has no credits. Add billing at https://console.x.ai";
      } else if (response.status === 401 || /invalid.*key|unauthorized|authentication/i.test(msg)) {
        msg += "\n\nYour API key may be invalid. Check it at https://console.x.ai";
      } else if (response.status === 429) {
        msg += "\n\nRate limit hit. Wait a moment and try again, or add billing at https://console.x.ai";
      }

      throw new Error(msg);
    }

    return response.json();
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

  const pollVideoResult = useCallback(async (requestId: string): Promise<any> => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API key not configured");

    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      let response: Response;
      try {
        response = await fetch(`${API_BASE}/videos/${requestId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
      } catch (fetchErr: any) {
        // Network error — retry instead of crashing
        console.warn(`[pollVideo] Network error on attempt ${i + 1}:`, fetchErr.message);
        continue;
      }

      // 202 Accepted means still processing — consume body and continue
      if (response.status === 202) {
        await response.text().catch(() => { }); // drain response body
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorMsg = `Video polling failed (HTTP ${response.status})`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) errorMsg = errorData.error.message;
          else if (errorData.message) errorMsg = errorData.message;
        } catch {
          if (errorText) errorMsg += `: ${errorText.slice(0, 200)}`;
        }
        console.warn(`[pollVideo] Error on attempt ${i + 1}:`, response.status, errorText.slice(0, 300));
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const currentStatus = data.status || data.state || "unknown";

      if (currentStatus === "done" || currentStatus === "completed" || currentStatus === "succeeded") {
        return data;
      }

      if (currentStatus === "failed" || currentStatus === "error") {
        throw new Error(data.error?.message || data.message || "Video generation failed");
      }

      const earlyUrl = data.video?.url || data.video_url || data.url;
      if (earlyUrl) {
        return data;
      }
    }

    throw new Error("Video generation timed out after 6 minutes");
  }, [getApiKey]);

  // ── Persist a batch of new results to IndexedDB ──
  const persistNewResults = useCallback(async (newResults: GrokResult[]) => {
    for (const r of newResults) {
      try { await saveResult(r); } catch { /* best-effort */ }
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

      setResults(prev => [...newResults, ...prev]);
      persistNewResults(newResults);
      return newResults;
    } catch (err: any) {
      setError(friendlyError(err.message));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [apiMode, makeRequest, makeProxyRequest, persistNewResults]);

  // Edit Image
  const editImage = useCallback(async (params: EditImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const safeImageUrl = params.image_url.startsWith("data:")
        ? params.image_url
        : await urlToBase64(params.image_url);

      const body: Record<string, unknown> = {
        model: params.pro ? "grok-imagine-image-pro" : "grok-imagine-image",
        prompt: params.prompt,
        image: { url: safeImageUrl },
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

      setResults(prev => [...newResults, ...prev]);
      persistNewResults(newResults);
      return newResults;
    } catch (err: any) {
      setError(friendlyError(err.message));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [apiMode, makeRequest, makeProxyRequest, persistNewResults]);

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
    const timerIv = setInterval(() => {
      setComfyJobs(prev => prev.map(j =>
        j.id === jobId && (j.status === "submitting" || j.status === "generating")
          ? { ...j, elapsed: Math.floor((Date.now() - startTime) / 1000) }
          : j
      ));
    }, 1000);
    comfyTimerRefs.current.set(jobId, timerIv);

    (async () => {
      try {
        const safeImageUrl = params.image_url.startsWith("data:")
          ? params.image_url
          : await urlToBase64(params.image_url);

        const body: Record<string, unknown> = {
          model: params.pro ? "grok-imagine-image-pro" : "grok-imagine-image",
          prompt: params.prompt,
          image: { url: safeImageUrl },
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

        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);

        const newResults: GrokResult[] = data.data.map((item: any, i: number) => ({
          id: `edit-${Date.now()}-${i}`,
          url: item.b64_json
            ? `data:image/png;base64,${item.b64_json}`
            : item.url,
          revised_prompt: item.revised_prompt,
          type: "image" as const,
          timestamp: Date.now(),
        }));

        setResults(prev => [...newResults, ...prev]);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: friendlyError(err.message), phase: null }
          : j
        ));
      }
    })();
  }, [apiMode, makeRequest, makeProxyRequest, persistNewResults]);

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
      } else {
        body.aspect_ratio = params.videoSettings.aspectRatio;
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
        setResults(prev => [...newResults, ...prev]);
        persistNewResults(newResults);
        return newResults;
      }

      // BYOK mode: direct xAI calls with client-side polling
      const submitData = await makeRequest("/videos/generations", body);
      console.info("[generateVideo] Submit response keys:", Object.keys(submitData));
      const requestId = submitData.request_id || submitData.id;

      if (!requestId) {
        throw new Error("No request ID returned from video generation. Response: " + JSON.stringify(submitData).slice(0, 500));
      }
      console.info("[generateVideo] Polling requestId:", requestId);

      const data = await pollVideoResult(requestId);

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

      setResults(prev => [...newResults, ...prev]);
      persistNewResults(newResults);
      return newResults;
    } catch (err: any) {
      setError(friendlyError(err.message));
      throw err;
    } finally {
      setIsLoading(false);
      stopTimer();
    }
  }, [apiMode, makeRequest, makeProxyRequest, pollVideoResult, persistNewResults, startTimer, stopTimer]);

  // Edit Video (video-to-video with text prompt)
  const editVideo = useCallback(async (params: EditVideoParams) => {
    setIsLoading(true);
    setError(null);
    startTimer();
    try {
      const body: Record<string, unknown> = {
        model: "grok-imagine-video",
        prompt: params.prompt,
        video_url: params.video_url,
        ...(params.testCredits ? { testCredits: true } : {}),
      };

      if (apiMode === "credits") {
        const data = await makeProxyRequest("edit-video", body);
        const videoUrl = data.video?.url || data.video_url || data.url || data.data?.[0]?.url;
        if (!videoUrl) {
          throw new Error("No video URL found in proxy result");
        }
        const newResults: GrokResult[] = [{
          id: `vid-edit-${Date.now()}`,
          url: videoUrl,
          revised_prompt: data.revised_prompt || data.data?.[0]?.revised_prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        setResults(prev => [...newResults, ...prev]);
        persistNewResults(newResults);
        return newResults;
      }

      const startData = await makeRequest("/videos/edits", body);
      const requestId = startData.request_id || startData.id;
      if (!requestId) {
        throw new Error("No request_id returned. Response: " + JSON.stringify(startData).slice(0, 300));
      }

      const data = await pollVideoResult(requestId);
      const videoUrl = data.video?.url || data.video_url || data.url || data.data?.[0]?.url;
      if (!videoUrl) {
        throw new Error("No video URL found in result.");
      }

      const newResults: GrokResult[] = [{
        id: `vid-edit-${Date.now()}`,
        url: videoUrl,
        revised_prompt: data.revised_prompt,
        type: "video" as const,
        timestamp: Date.now(),
      }];

      setResults(prev => [...newResults, ...prev]);
      persistNewResults(newResults);
      return newResults;
    } catch (err: any) {
      setError(friendlyError(err.message));
      throw err;
    } finally {
      setIsLoading(false);
      stopTimer();
    }
  }, [apiMode, makeRequest, makeProxyRequest, pollVideoResult, persistNewResults, startTimer, stopTimer]);

  // GLTCH Edit (Qwen model via /api/gltch) — fire-and-forget with queue
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
    const timerIv = setInterval(() => {
      setComfyJobs(prev => prev.map(j =>
        j.id === jobId && (j.status === "submitting" || j.status === "generating")
          ? { ...j, elapsed: Math.floor((Date.now() - startTime) / 1000) }
          : j
      ));
    }, 1000);
    comfyTimerRefs.current.set(jobId, timerIv);

    (async () => {
      try {
        const imageBase64 = params.image_url.startsWith("data:")
          ? params.image_url
          : await urlToBase64(params.image_url);

        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));

        const submitData = await apiFetch<{
          promptId: string;
          seed: number;
          syncResult?: { status: string; image?: string; error?: string };
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

        try {
          localStorage.setItem("comfy-active-job", JSON.stringify({
            promptId: submitData.promptId,
            outputType: "image",
            submittedAt: Date.now(),
            pollEndpoint: "gltch",
          }));
        } catch { /* best-effort */ }

        // runsync may return result directly
        if (submitData.syncResult?.status === "done" && submitData.syncResult.image) {
          localStorage.removeItem("comfy-active-job");
          clearInterval(timerIv);
          comfyTimerRefs.current.delete(jobId);
          const newResults: GrokResult[] = [{
            id: `gltch-${Date.now()}`,
            url: submitData.syncResult.image,
            revised_prompt: `GLTCH Edit: ${params.prompt}`,
            type: "image" as const,
            timestamp: Date.now(),
          }];
          setResults(prev => [...newResults, ...prev]);
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
            error?: string;
          }>("/gltch", {
            method: "POST",
            body: { action: "poll", promptId: submitData.promptId },
          });

          if (pollData.status === "done" && pollData.image) {
            clearInterval(timerIv);
            comfyTimerRefs.current.delete(jobId);
            localStorage.removeItem("comfy-active-job");
            const newResults: GrokResult[] = [{
              id: `gltch-${Date.now()}`,
              url: pollData.image,
              revised_prompt: `GLTCH Edit: ${params.prompt}`,
              type: "image" as const,
              timestamp: Date.now(),
            }];
            setResults(prev => [...newResults, ...prev]);
            persistNewResults(newResults);
            setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null, seed: submitData.seed } : j));
            return;
          }

          if (pollData.status === "error") {
            localStorage.removeItem("comfy-active-job");
            throw new Error(pollData.error || "GLTCH edit failed");
          }
        }

        localStorage.removeItem("comfy-active-job");
        throw new Error("GLTCH edit timed out after 4 minutes");
      } catch (err: any) {
        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "GLTCH edit failed", phase: null }
          : j
        ));
      }
    })();
  }, [persistNewResults]);

  const clearResults = useCallback(async () => {
    setResults([]);
    revokeAllRef.current?.();
    revokeAllRef.current = null;
    try { await clearStoredResults(); } catch { /* best-effort */ }
  }, []);

  const deleteResult = useCallback(async (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
    try { await deleteStoredResult(id); } catch { /* best-effort */ }
  }, []);

  /** Update a result's folderId in React state (IndexedDB update is handled separately). */
  const updateResultFolder = useCallback((resultId: string, folderId: string | null) => {
    setResults(prev => prev.map(r => r.id === resultId ? { ...r, folderId } : r));
  }, []);

  /** Add an externally-produced result (e.g. from ComfyUI) to the gallery. */
  const addExternalResult = useCallback(async (result: GrokResult) => {
    setResults(prev => [result, ...prev]);
    try { await saveResult(result); } catch { /* best-effort */ }
  }, []);

  // ── ComfyUI Job Queue ─────────────────────────────────────────────────────

  const [comfyJobs, setComfyJobs] = useState<ComfyJob[]>([]);
  const comfyTimerRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      comfyTimerRefs.current.forEach(iv => clearInterval(iv));
    };
  }, []);

  const dismissComfyJob = useCallback((jobId: string) => {
    const iv = comfyTimerRefs.current.get(jobId);
    if (iv) { clearInterval(iv); comfyTimerRefs.current.delete(jobId); }
    setComfyJobs(prev => prev.filter(j => j.id !== jobId));
  }, []);

  const clearFinishedComfyJobs = useCallback(() => {
    setComfyJobs(prev => {
      const removed = prev.filter(j => j.status === "done" || j.status === "error");
      for (const j of removed) {
        const iv = comfyTimerRefs.current.get(j.id);
        if (iv) { clearInterval(iv); comfyTimerRefs.current.delete(j.id); }
      }
      return prev.filter(j => j.status !== "done" && j.status !== "error");
    });
  }, []);

  // ── ComfyUI Functions ────────────────────────────────────────────────────

  // Shared submit + poll helper for ComfyUI workflows
  const comfySubmitAndPoll = useCallback(async (
    body: Record<string, any>,
    opts: { pollInterval?: number; maxAttempts?: number } = {},
  ): Promise<{ image?: string; video?: string }> => {
    const { pollInterval = 2000, maxAttempts = 300 } = opts;

    const submitData = await apiFetch<{
      promptId: string;
      seed: number;
      outputType?: string;
      runpodEndpointId?: string;
    }>("/comfyui", { method: "POST", body: { action: "generate", ...body } });

    const { promptId, outputType, runpodEndpointId } = submitData;
    const outType = outputType || (body.workflow === "wan-video" || body.workflow === "longlook" ? "video" : "image");

    // Save to localStorage so we can resume if page closes
    try {
      localStorage.setItem("comfy-active-job", JSON.stringify({
        promptId,
        outputType: outType,
        submittedAt: Date.now(),
        ...(runpodEndpointId && { runpodEndpointId }),
      }));
    } catch { /* best-effort */ }

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
        localStorage.removeItem("comfy-active-job");

        // If video is an S3 URL (not base64/data URI), proxy through backend
        let video = pollData.video;
        if (video && video.startsWith("https://") && !video.startsWith("data:")) {
          try {
            console.log("[comfy-poll] Proxying S3 video through backend...");
            const proxyResp = await fetch("/api/comfyui", {
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

        return { image: pollData.image, video };
      }
      if (pollData.status === "error") {
        localStorage.removeItem("comfy-active-job");
        throw new Error(pollData.error || "ComfyUI generation failed");
      }
    }

    localStorage.removeItem("comfy-active-job");
    throw new Error("ComfyUI generation timed out");
  }, []);

  /** Two-phase status for chained text-to-video */
  const [comfyPhase, setComfyPhase] = useState<string | null>(null);

  /** ComfyUI models + LoRAs (fetched on demand) */
  const [comfyModels, setComfyModels] = useState<{
    checkpoints: string[];
    loras: string[];
    videoLoras: VideoLoraEntry[];
    qwenLoras: string[];
    xrgeHolder: boolean;
  }>({
    checkpoints: [],
    loras: [],
    videoLoras: [],
    qwenLoras: [],
    xrgeHolder: false,
  });

  const fetchComfyModels = useCallback(async () => {
    try {
      const data = await apiFetch<{
        checkpoints: string[];
        loras?: string[];
        videoLoras?: VideoLoraEntry[];
        qwenLoras?: string[];
        xrgeHolder?: boolean;
      }>("/comfyui", {
        method: "POST",
        body: { action: "models" },
      });
      setComfyModels({
        checkpoints: data.checkpoints || [],
        loras: data.loras || [],
        videoLoras: data.videoLoras || [],
        qwenLoras: data.qwenLoras || [],
        xrgeHolder: data.xrgeHolder ?? false,
      });
    } catch {
      setComfyModels({ checkpoints: [], loras: [], videoLoras: [], qwenLoras: [], xrgeHolder: false });
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
    const timerIv = setInterval(() => {
      setComfyJobs(prev => prev.map(j =>
        j.id === jobId && (j.status === "submitting" || j.status === "generating")
          ? { ...j, elapsed: Math.floor((Date.now() - startTime) / 1000) }
          : j
      ));
    }, 1000);
    comfyTimerRefs.current.set(jobId, timerIv);

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
        });

        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);

        if (!result.image) throw new Error("No image returned from ComfyUI");

        const newResults: GrokResult[] = [{
          id: `comfy-img-${Date.now()}`,
          url: result.image,
          revised_prompt: params.prompt,
          type: "image" as const,
          timestamp: Date.now(),
        }];
        setResults(prev => [...newResults, ...prev]);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "Generation failed", phase: null }
          : j
        ));
      }
    })();
  }, [comfySubmitAndPoll, persistNewResults]);

  // ComfyUI Qwen Edit (fire-and-forget — uses qwen-edit workflow with stacked LoRAs)
  const comfyEdit = useCallback((params: {
    prompt: string;
    negativePrompt?: string;
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
    upscale?: boolean;
    testCredits?: boolean;
  }) => {
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: params.upscale ? "qwen-edit-hd" : "qwen-edit",
      prompt: label, phase: "Editing image...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    const timerIv = setInterval(() => {
      setComfyJobs(prev => prev.map(j =>
        j.id === jobId && (j.status === "submitting" || j.status === "generating")
          ? { ...j, elapsed: Math.floor((Date.now() - startTime) / 1000) }
          : j
      ));
    }, 1000);
    comfyTimerRefs.current.set(jobId, timerIv);

    (async () => {
      try {
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));
        const result = await comfySubmitAndPoll({
          workflow: "qwen-edit",
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          imageBase64: params.imageBase64,
          imageFilename: params.imageFilename || "input.jpg",
          imageBase64_2: params.imageBase64_2,
          imageFilename2: params.imageFilename2,
          width: params.width || 1024,
          height: params.height || 1024,
          steps: params.steps || 5,
          cfg: params.cfg || 4,
          seed: params.seed,
          loras: params.loras?.filter(l => l.name !== "none"),
          upscale: params.upscale || false,
          ...(params.testCredits ? { testCredits: true } : {}),
        });

        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);

        if (!result.image) throw new Error("No image returned from ComfyUI");

        const newResults: GrokResult[] = [{
          id: `comfy-edit-${Date.now()}`,
          url: result.image,
          revised_prompt: params.prompt,
          type: "image" as const,
          timestamp: Date.now(),
        }];
        setResults(prev => [...newResults, ...prev]);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "Edit failed", phase: null }
          : j
        ));
      }
    })();
  }, [comfySubmitAndPoll, persistNewResults]);

  // ComfyUI Image-to-Video (WAN Video) — fire-and-forget
  const comfyVideo = useCallback((params: {
    prompt: string;
    negativePrompt?: string;
    imageBase64: string;
    imageFilename?: string;
    width?: number;
    height?: number;
    frameCount?: number;
    steps?: number;
    cfg?: number;
    seed?: number;
    useRife?: boolean;
    useUpscale?: boolean;
    videoLora?: string;
    videoLoraStrength?: number;
    videoLoraPass?: "high" | "low" | "both";
    workflow?: string;
    resolution?: number;
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
    const timerIv = setInterval(() => {
      setComfyJobs(prev => prev.map(j =>
        j.id === jobId && (j.status === "submitting" || j.status === "generating")
          ? { ...j, elapsed: Math.floor((Date.now() - startTime) / 1000) }
          : j
      ));
    }, 1000);
    comfyTimerRefs.current.set(jobId, timerIv);

    (async () => {
      try {
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "generating" } : j));
        const result = await comfySubmitAndPoll({
          workflow: wfType,
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          imageBase64: params.imageBase64,
          imageFilename: params.imageFilename || "input.jpg",
          width: params.width || 832,
          height: params.height || 480,
          frameCount: params.frameCount || 81,
          steps: params.steps || 8,
          cfg: params.cfg || 1,
          seed: params.seed,
          useRife: params.useRife ?? true,
          useUpscale: params.useUpscale ?? false,
          videoLora: params.videoLora,
          videoLoraStrength: params.videoLoraStrength,
          videoLoraPass: params.videoLoraPass,
          resolution: params.resolution,
          stage1End: params.stage1End,
          stage2End: params.stage2End,
          audioMode: params.audioMode || "none",
          audioPrompt: params.audioPrompt,
          ...(params.testCredits ? { testCredits: true } : {}),
        }, { pollInterval: 5000, maxAttempts: 120 });

        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);

        const videoSrc = result.video || result.image;
        if (!videoSrc) throw new Error("No video returned from ComfyUI");

        const newResults: GrokResult[] = [{
          id: `comfy-vid-${Date.now()}`,
          url: videoSrc,
          revised_prompt: params.prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        setResults(prev => [...newResults, ...prev]);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "Render failed", phase: null }
          : j
        ));
      }
    })();
  }, [comfySubmitAndPoll, persistNewResults]);

  // ComfyUI Chained Text-to-Video (txt2img → wan-video) — fire-and-forget
  const comfyTextToVideo = useCallback((params: {
    prompt: string;
    negativePrompt?: string;
    checkpoint: string;
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    frameCount?: number;
    useRife?: boolean;
    videoLora?: string;
    videoLoraStrength?: number;
    videoLoraPass?: "high" | "low" | "both";
    testCredits?: boolean;
  }) => {
    const jobId = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = params.prompt.length > 80 ? params.prompt.slice(0, 80) + "…" : params.prompt;

    const newJob: ComfyJob = {
      id: jobId, status: "submitting", workflowType: "txt2video",
      prompt: label, phase: "Generating start frame...", elapsed: 0, seed: null, error: null,
    };
    setComfyJobs(prev => [newJob, ...prev]);

    const startTime = Date.now();
    const timerIv = setInterval(() => {
      setComfyJobs(prev => prev.map(j =>
        j.id === jobId && (j.status === "submitting" || j.status === "generating")
          ? { ...j, elapsed: Math.floor((Date.now() - startTime) / 1000) }
          : j
      ));
    }, 1000);
    comfyTimerRefs.current.set(jobId, timerIv);

    (async () => {
      try {
        // Phase 1: Generate start frame (skipCredits — video step pays for both)
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "generating", phase: "Generating start frame..." }
          : j
        ));
        const imgResult = await comfySubmitAndPoll({
          workflow: "txt2img",
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          checkpoint: params.checkpoint,
          width: params.width || 832,
          height: params.height || 480,
          steps: params.steps || 5,
          cfg: params.cfg || 1,
          skipCredits: true,
        });

        if (!imgResult.image) throw new Error("Failed to generate start frame");

        // Phase 2: Animate with WAN Video
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, phase: "Rendering video..." }
          : j
        ));
        const vidResult = await comfySubmitAndPoll({
          workflow: "wan-video",
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          imageBase64: imgResult.image,
          imageFilename: "start_frame.png",
          width: params.width || 832,
          height: params.height || 480,
          frameCount: params.frameCount || 81,
          steps: params.steps || 8,
          cfg: params.cfg || 1,
          useRife: params.useRife ?? true,
          useUpscale: false,
          videoLora: params.videoLora,
          videoLoraStrength: params.videoLoraStrength,
          videoLoraPass: params.videoLoraPass,
          ...(params.testCredits ? { testCredits: true } : {}),
        }, { pollInterval: 5000, maxAttempts: 120 });

        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);

        const videoSrc = vidResult.video || vidResult.image;
        if (!videoSrc) throw new Error("No video returned from ComfyUI");

        const newResults: GrokResult[] = [{
          id: `comfy-t2v-${Date.now()}`,
          url: videoSrc,
          revised_prompt: params.prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        setResults(prev => [...newResults, ...prev]);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "Chained render failed", phase: null }
          : j
        ));
      }
    })();
  }, [comfySubmitAndPoll, persistNewResults]);

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
    const timerIv = setInterval(() => {
      setComfyJobs(prev => prev.map(j =>
        j.id === jobId && (j.status === "submitting" || j.status === "generating")
          ? { ...j, elapsed: Math.floor((Date.now() - startTime) / 1000) }
          : j
      ));
    }, 1000);
    comfyTimerRefs.current.set(jobId, timerIv);

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
        }, { pollInterval: 5000, maxAttempts: 240 });

        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);

        const videoSrc = result.video || result.image;
        if (!videoSrc) throw new Error("No video returned from ComfyUI");

        const newResults: GrokResult[] = [{
          id: `comfy-ll-${Date.now()}`,
          url: videoSrc,
          revised_prompt: params.prompt,
          type: "video" as const,
          timestamp: Date.now(),
        }];
        setResults(prev => [...newResults, ...prev]);
        persistNewResults(newResults);
        setComfyJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "done", phase: null } : j));
      } catch (err: any) {
        clearInterval(timerIv);
        comfyTimerRefs.current.delete(jobId);
        setComfyJobs(prev => prev.map(j => j.id === jobId
          ? { ...j, status: "error", error: err.message || "LongLook render failed", phase: null }
          : j
        ));
      }
    })();
  }, [comfySubmitAndPoll, persistNewResults]);

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
    editVideo,
    gltchEdit,
    comfyGenerate,
    comfyEdit,
    comfyVideo,
    comfyTextToVideo,
    comfyLongLook,
    comfyPhase,
    comfyJobs,
    dismissComfyJob,
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
