import { useState, useCallback, useEffect } from "react";

export type GrokMode = "text-to-image" | "edit-image" | "text-to-video" | "image-to-video";

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "2:1" | "1:2";
export type VideoAspectRatio = "16:9" | "4:3" | "1:1" | "9:16" | "3:4" | "3:2" | "2:3";
export type VideoResolution = "720p" | "480p";
export type ImageFormat = "url" | "base64";
export type ImageCount = 1 | 2 | 3 | 4;

export interface GenerationSettings {
  aspectRatio: AspectRatio;
  imageFormat: ImageFormat;
  count: ImageCount;
}

export interface VideoSettings {
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number; // 1–15 seconds
}

export const DEFAULT_SETTINGS: GenerationSettings = {
  aspectRatio: "1:1",
  imageFormat: "url",
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

/** Convert an image URL to a base64 data-URL so the xAI API can always access it
 *  (their generated URLs are temporary and may expire before editing). */
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
    // CORS or network error — return original URL as fallback
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
    localStorage.setItem(RESULTS_STORAGE_KEY, JSON.stringify(results));
  } catch {
    // localStorage full — silently fail
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
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const response = await fetch(`${API_BASE}/videos/${requestId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Polling error: ${response.status}`);
      }

      const data = await response.json();

      if (data.state === "completed" || data.status === "completed") {
        return data;
      }

      if (data.state === "failed" || data.status === "failed") {
        throw new Error(data.error?.message || "Video generation failed");
      }
    }

    throw new Error("Video generation timed out");
  }, [getApiKey]);

  // Text-to-Image: POST /v1/images/generations
  const generateImage = useCallback(async (params: GenerateImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        model: "grok-imagine-image",
        prompt: params.prompt,
        n: params.settings.count,
        aspect_ratio: params.settings.aspectRatio,
      };

      if (params.settings.imageFormat === "base64") {
        body.response_format = "b64_json";
      }

      const data = await makeRequest("/images/generations", body);

      const newResults: GrokResult[] = data.data.map((item: any, i: number) => ({
        id: `img-${Date.now()}-${i}`,
        url: item.url || `data:image/png;base64,${item.b64_json}`,
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

  // Edit Image: same endpoint /v1/images/generations with image_url param
  // Note: n and response_format are not supported when image_url is provided
  const editImage = useCallback(async (params: EditImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      // Convert to base64 so the API can always access the image
      // (xAI-generated URLs are temporary and may expire)
      const safeImageUrl = await urlToBase64(params.image_url);

      const body: Record<string, unknown> = {
        model: "grok-imagine-image",
        prompt: params.prompt,
        image_url: safeImageUrl,
      };

      const data = await makeRequest("/images/generations", body);

      const newResults: GrokResult[] = data.data.map((item: any, i: number) => ({
        id: `edit-${Date.now()}-${i}`,
        url: item.url || `data:image/png;base64,${item.b64_json}`,
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
  const generateVideo = useCallback(async (params: GenerateVideoParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        model: "grok-imagine-video",
        prompt: params.prompt,
        aspect_ratio: params.videoSettings.aspectRatio,
        resolution: params.videoSettings.resolution,
        duration: params.videoSettings.duration,
      };
      if (params.image_url) {
        body.image_url = await urlToBase64(params.image_url);
      }

      const submitData = await makeRequest("/videos/generations", body);
      const requestId = submitData.request_id || submitData.id;

      if (!requestId) {
        throw new Error("No request ID returned from video generation");
      }

      const data = await pollVideoResult(requestId);

      const videoUrl = data.video_url || data.data?.[0]?.url || data.url;
      if (!videoUrl) {
        throw new Error("No video URL in completed result");
      }

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
