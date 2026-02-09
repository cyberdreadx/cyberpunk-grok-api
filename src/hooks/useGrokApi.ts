import { useState, useCallback, useEffect, useRef } from "react";
import {
  saveResult,
  loadResults,
  deleteStoredResult,
  clearStoredResults,
  migrateFromLocalStorage,
} from "@/lib/storage";

export type GrokMode = "text-to-image" | "edit-image" | "text-to-video" | "image-to-video";

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
}

interface GenerateImageParams {
  prompt: string;
  settings: GenerationSettings;
}

interface EditImageParams {
  prompt: string;
  image_url: string;
  settings: GenerationSettings;
}

interface GenerateVideoParams {
  prompt: string;
  image_url?: string;
  videoSettings: VideoSettings;
}

const API_BASE = "https://api.x.ai/v1";

/** Convert an external URL to a base64 data-URL (used for user-provided URLs). */
async function urlToBase64(url: string): Promise<string> {
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

export function useGrokApi() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GrokResult[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    return response.json();
  }, [getApiKey]);

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
        await response.text().catch(() => {}); // drain response body
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
        model: "grok-imagine-image",
        prompt: params.prompt,
        n: params.settings.count,
        aspect_ratio: params.settings.aspectRatio,
        response_format: "b64_json",
      };

      const data = await makeRequest("/images/generations", body);

      const newResults: GrokResult[] = data.data.map((item: any, i: number) => ({
        id: `img-${Date.now()}-${i}`,
        url: `data:image/png;base64,${item.b64_json}`,
        revised_prompt: item.revised_prompt,
        type: "image" as const,
        timestamp: Date.now(),
      }));

      setResults(prev => [...newResults, ...prev]);
      persistNewResults(newResults);
      return newResults;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest, persistNewResults]);

  // Edit Image
  const editImage = useCallback(async (params: EditImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const safeImageUrl = params.image_url.startsWith("data:")
        ? params.image_url
        : await urlToBase64(params.image_url);

      const body: Record<string, unknown> = {
        model: "grok-imagine-image",
        prompt: params.prompt,
        image: { url: safeImageUrl },
        n: params.settings.count,
        response_format: "b64_json",
      };

      const data = await makeRequest("/images/edits", body);

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
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest, persistNewResults]);

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
      };

      if (params.image_url) {
        body.image = { url: params.image_url };
      } else {
        body.aspect_ratio = params.videoSettings.aspectRatio;
      }

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
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
      stopTimer();
    }
  }, [makeRequest, pollVideoResult, persistNewResults, startTimer, stopTimer]);

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

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isLoading,
    error,
    results,
    elapsedSeconds,
    storageReady,
    getApiKey,
    setApiKey,
    clearApiKey,
    hasApiKey,
    generateImage,
    editImage,
    generateVideo,
    clearResults,
    deleteResult,
    clearError,
  };
}
