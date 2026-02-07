import { useState, useCallback, useEffect } from "react";

export type GrokMode = "text-to-image" | "edit-image" | "text-to-video" | "image-to-video";

export type ImageSize = "1024x1024" | "1024x1792" | "1792x1024" | "512x512";
export type ResponseFormat = "url" | "b64_json";
export type ImageCount = 1 | 2 | 3 | 4;

export interface GenerationSettings {
  size: ImageSize;
  responseFormat: ResponseFormat;
  count: ImageCount;
}

export const DEFAULT_SETTINGS: GenerationSettings = {
  size: "1024x1024",
  responseFormat: "url",
  count: 1,
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
}

const API_BASE = "https://api.x.ai/v1";
const RESULTS_STORAGE_KEY = "grok-results";

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
    // localStorage full — silently fail, results still live in state
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

  // Persist results to localStorage whenever they change
  useEffect(() => {
    persistResults(results);
  }, [results]);

  const makeRequest = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API key not configured");

    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    return response.json();
  }, [getApiKey]);

  const generateImage = useCallback(async (params: GenerateImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await makeRequest("/images/generations", {
        model: "grok-2-image",
        prompt: params.prompt,
        n: params.settings.count,
        response_format: params.settings.responseFormat,
      });

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

  const editImage = useCallback(async (params: EditImageParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await makeRequest("/images/generations", {
        model: "grok-2-image",
        prompt: params.prompt,
        image_url: params.image_url,
        n: params.settings.count,
        response_format: params.settings.responseFormat,
      });

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

  const generateVideo = useCallback(async (params: GenerateVideoParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        model: "grok-2-image",
        prompt: params.prompt,
      };
      if (params.image_url) {
        body.image_url = params.image_url;
      }

      const data = await makeRequest("/images/generations", body);

      const newResults: GrokResult[] = data.data.map((item: any, i: number) => ({
        id: `vid-${Date.now()}-${i}`,
        url: item.url,
        revised_prompt: item.revised_prompt,
        type: "video" as const,
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
