import { useState, useCallback, useEffect } from "react";

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
const RESULTS_STORAGE_KEY = "grok-results";

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

function loadPersistedResults(): GrokResult[] {
  try {
    const stored = localStorage.getItem(RESULTS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function persistResults(results: GrokResult[]) {
  try {
    // Limit stored results to avoid localStorage overflow with large base64 images
    const toStore = results.slice(0, 20);
    localStorage.setItem(RESULTS_STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // localStorage full — try storing fewer results
    try {
      const minimal = results.slice(0, 5);
      localStorage.setItem(RESULTS_STORAGE_KEY, JSON.stringify(minimal));
    } catch {
      // Still too large — clear storage
      localStorage.removeItem(RESULTS_STORAGE_KEY);
    }
  }
}

export function useGrokApi() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GrokResult[]>(loadPersistedResults);

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

  useEffect(() => {
    persistResults(results);
  }, [results]);

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

      console.log(`[pollVideo] Attempt ${i + 1}/${maxAttempts} for requestId: ${requestId}`);

      const response = await fetch(`${API_BASE}/videos/${requestId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      // 202 Accepted means still processing — continue polling
      // NOTE: 202 is a 2xx status so response.ok is true; must check before parsing body
      if (response.status === 202) {
        console.log("[pollVideo] Got 202 Accepted — still processing");
        continue;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("[pollVideo] Error response:", response.status, JSON.stringify(errorData));
        throw new Error(errorData.error?.message || `Polling error: ${response.status}`);
      }

      const data = await response.json();
      const currentStatus = data.status || data.state || "unknown";
      console.log(`[pollVideo] Response status: "${currentStatus}", keys: ${JSON.stringify(Object.keys(data))}`);

      // xAI uses status: "done" for completion, "pending" for in-progress
      if (currentStatus === "done" || currentStatus === "completed" || currentStatus === "succeeded") {
        console.log("[pollVideo] Video completed!", JSON.stringify(Object.keys(data)));
        return data;
      }

      // Check for failure
      if (currentStatus === "failed" || currentStatus === "error") {
        console.error("[pollVideo] Video failed:", JSON.stringify(data));
        throw new Error(data.error?.message || data.message || "Video generation failed");
      }

      // If the response already contains a video URL (e.g. video.url), treat as completed
      const earlyUrl = data.video?.url || data.video_url || data.url;
      if (earlyUrl) {
        console.log("[pollVideo] Found video URL in response, treating as completed");
        return data;
      }

      // Log ongoing states for debugging
      console.log(`[pollVideo] Still processing (status: "${currentStatus}"), waiting...`);
    }

    throw new Error("Video generation timed out after 6 minutes");
  }, [getApiKey]);

  // Text-to-Image: POST /v1/images/generations
  // Always request b64_json so we get embedded data that never expires
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
      return newResults;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest]);

  // Edit Image: POST /v1/images/edits
  // xAI REST API requires JSON with: image: { url: "..." } (nested object)
  const editImage = useCallback(async (params: EditImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      // Ensure image is a data URL (not an expired temporary URL)
      const safeImageUrl = params.image_url.startsWith("data:")
        ? params.image_url
        : await urlToBase64(params.image_url);

      console.log("[editImage] image url type:", safeImageUrl.startsWith("data:") ? "data-url" : "url");
      console.log("[editImage] image url length:", safeImageUrl.length);

      const body: Record<string, unknown> = {
        model: "grok-imagine-image",
        prompt: params.prompt,
        image: { url: safeImageUrl },
        n: params.settings.count,
        response_format: "b64_json",
      };

      console.log("[editImage] Sending request body keys:", Object.keys(body));

      const data = await makeRequest("/images/edits", body);
      console.log("[editImage] Response data keys:", Object.keys(data));
      console.log("[editImage] Response data.data length:", data.data?.length);

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
      return newResults;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest]);

  // Video: POST /v1/videos/generations → poll GET /v1/videos/{request_id}
  // Response format: { video: { url, duration }, model, status }
  const generateVideo = useCallback(async (params: GenerateVideoParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        model: "grok-imagine-video",
        prompt: params.prompt,
        duration: params.videoSettings.duration,
      };

      if (params.image_url) {
        // For image-to-video: use image: { url: "..." } nested object (xAI REST spec)
        body.image = { url: params.image_url };
        // Don't send aspect_ratio when an image is provided — auto-detected from input
        console.log("[generateVideo] image-to-video, image type:", params.image_url.startsWith("data:") ? "data-url" : "url");
        console.log("[generateVideo] image url length:", params.image_url.length);
      } else {
        // Text-to-video: include aspect_ratio
        body.aspect_ratio = params.videoSettings.aspectRatio;
      }

      console.log("[generateVideo] Request body keys:", Object.keys(body));
      const submitData = await makeRequest("/videos/generations", body);
      console.log("[generateVideo] Submit response:", JSON.stringify(submitData));
      const requestId = submitData.request_id || submitData.id;

      if (!requestId) {
        throw new Error("No request ID returned from video generation. Response: " + JSON.stringify(submitData));
      }

      console.log("[generateVideo] Polling with requestId:", requestId);
      const data = await pollVideoResult(requestId);
      console.log("[generateVideo] Poll completed. Full response keys:", JSON.stringify(Object.keys(data)));
      console.log("[generateVideo] Response snippet:", JSON.stringify(data, (key, val) => {
        if (typeof val === "string" && val.length > 200) return val.substring(0, 200) + "...[truncated]";
        return val;
      }));

      // xAI response: { video: { url, duration }, model, status }
      const videoUrl = data.video?.url || data.video_url || data.url || data.data?.[0]?.url;
      if (!videoUrl) {
        throw new Error("No video URL found in result. Keys: " + JSON.stringify(Object.keys(data)));
      }

      console.log("[generateVideo] Video URL found:", videoUrl.substring(0, 100));

      const newResults: GrokResult[] = [{
        id: `vid-${Date.now()}`,
        url: videoUrl,
        revised_prompt: data.revised_prompt || data.data?.[0]?.revised_prompt,
        type: "video" as const,
        timestamp: Date.now(),
      }];

      setResults(prev => [...newResults, ...prev]);
      return newResults;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest, pollVideoResult]);

  const clearResults = useCallback(() => {
    setResults([]);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isLoading,
    error,
    results,
    getApiKey,
    setApiKey,
    clearApiKey,
    hasApiKey,
    generateImage,
    editImage,
    generateVideo,
    clearResults,
    clearError,
  };
}
