import React, { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Terminal, Key, Coins, Shield, Eye, MessageCircle, HelpCircle, Server, Zap, Cpu, ChevronDown, Film, X, AlertCircle, CheckCircle2, Upload, Users, Image, Code, ToggleLeft, ToggleRight, Gift, Rss } from "lucide-react";
import { Link } from "react-router-dom";
import CyberLayout from "@/components/CyberLayout";
import StoriesBar from "@/components/StoriesBar";
import MobileBottomNav from "@/components/MobileBottomNav";
import SocialProofToast from "@/components/SocialProofToast";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { lazyWithRetry } from "@/lib/lazyWithRetry";
// Lazy-load the 3D orb — Three.js is ~800 KB and not needed for initial render
const GrokOrb = lazyWithRetry(() => import("@/components/GrokOrb"), "grok-orb");
import GlitchText from "@/components/GlitchText";
import ModeSelector from "@/components/ModeSelector";
import SimpleMode from "@/components/SimpleMode";
import PromptForm from "@/components/PromptForm";
import SettingsPanel from "@/components/SettingsPanel";
import {
  applyImmersionToRoot,
  DEFAULT_IMMERSION,
  fetchMasterImmersion,
  saveMasterImmersion,
  type ImmersionSettings,
} from "@/lib/immersion";
import PromptHistory from "@/components/PromptHistory";
import GalleryChunkLoader from "@/components/GalleryChunkLoader";
const ResultsGrid = lazyWithRetry(() => import("@/components/ResultsGrid"), "results-grid");
import ApiKeyDialog from "@/components/ApiKeyDialog";
import ApiKeysPanel from "@/components/ApiKeysPanel";
import AuthDialog from "@/components/AuthDialog";
import CreditDisplay from "@/components/CreditDisplay";
import NotificationBell from "@/components/NotificationBell";
import DailyMissionsDialog from "@/components/DailyMissionsDialog";
import { useDailyMissions } from "@/hooks/useDailyMissions";
import LegalDialog from "@/components/LegalDialog";
import HowToUseDialog from "@/components/HowToUseDialog";
import ChangelogDialog, { hasUnseenChangelog } from "@/components/ChangelogDialog";
import ThemePicker from "@/components/ThemePicker";
import PwaInstallBanner from "@/components/PwaInstallBanner";
import { useGrokApi, urlToBase64, getImageDimensions, type GrokMode, type GenerationSettings, type VideoSettings, type ApiMode, type VideoLoraEntry, type ComfyJob, DEFAULT_SETTINGS, DEFAULT_VIDEO_SETTINGS } from "@/hooks/useGrokApi";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useFolders } from "@/hooks/useFolders";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, calculateCreditCost, type CreditMode } from "@/lib/api";
import { AGE_VERIFIED_EVENT, isAgeVerified } from "@/lib/ageGate";
import { APP_VERSION } from "@/lib/version";

const ANNOUNCEMENTS: { id: string; message: string; type?: "info" | "warning" | "success" }[] = [
  { id: "gltch-wan-launch", message: "GLTCH Animate now defaults to a simpler WAN 2.2 stable mode for more reliable results.", type: "info" },
];

const SFW_LORA_KEYWORDS = ["skin", "angle"];
const isNsfwLora = (name: string) => !SFW_LORA_KEYWORDS.some(k => name.toLowerCase().includes(k));

const Index = () => {
  const [simpleMode, setSimpleMode] = useState(() => localStorage.getItem("ui-mode") !== "advanced");
  const [showToggleTooltip, setShowToggleTooltip] = useState(() => !localStorage.getItem("onboarding-toggle-seen"));
  const [showResultsTip, setShowResultsTip] = useState(false);
  const hasShownResultsTip = useRef(!!localStorage.getItem("results-tip-seen"));
  const [mode, setMode] = useState<GrokMode>("text-to-image");
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("dismissed_announcements") || "[]");
    } catch { return []; }
  });
  const dismissAnnouncement = useCallback((id: string) => {
    setDismissedAnnouncements(prev => {
      const next = [...prev, id];
      localStorage.setItem("dismissed_announcements", JSON.stringify(next));
      return next;
    });
  }, []);
  const visibleAnnouncements = ANNOUNCEMENTS.filter(a => !dismissedAnnouncements.includes(a.id));

  // Reddit reward banner
  const [redditRewardDismissed, setRedditRewardDismissed] = useState(() =>
    localStorage.getItem("reddit_reward_dismissed") === "1"
  );
  const [redditRewardClaimed, setRedditRewardClaimed] = useState(false);
  const [redditCodeOpen, setRedditCodeOpen] = useState(false);
  const [redditCode, setRedditCode] = useState("");
  const [redditClaimLoading, setRedditClaimLoading] = useState(false);
  const [redditClaimError, setRedditClaimError] = useState("");

  const [settings, setSettings] = useState<GenerationSettings>(() => {
    try {
      const saved = localStorage.getItem("grok-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(() => {
    try {
      const saved = localStorage.getItem("grok-video-settings");
      return saved ? { ...DEFAULT_VIDEO_SETTINGS, ...JSON.parse(saved) } : DEFAULT_VIDEO_SETTINGS;
    } catch {
      return DEFAULT_VIDEO_SETTINGS;
    }
  });

  /** Master immersion (server-backed); sliders sync when admin loads. */
  const [immersionSettings, setImmersionSettings] = useState<ImmersionSettings>(DEFAULT_IMMERSION);

  const handleSettingsChange = (next: GenerationSettings) => {
    setSettings(next);
    localStorage.setItem("grok-settings", JSON.stringify(next));
  };
  const handleVideoSettingsChange = (next: VideoSettings) => {
    setVideoSettings(next);
    localStorage.setItem("grok-video-settings", JSON.stringify(next));
  };

  const { toast } = useToast();
  const { t } = useTranslation();
  const {
    isLoading,
    error,
    results,
    elapsedSeconds,
    storageReady,
    apiMode,
    setApiMode,
    setApiKey: setApiKeyRaw,
    clearApiKey: clearApiKeyRaw,
    hasApiKey,
    generateImage,
    editImage,
    grokEditQueued,
    generateVideo,
    editVideo,
    comfyGenerate,
    comfyEdit,
    comfyVideo,
    comfyTextToVideo,
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
  } = useGrokApi();

  // Auth & Credits
  const auth = useAuth();
  const creditsHook = useCredits(auth.user);
  const missionsHook = useDailyMissions(auth.user);
  const isAdmin = !!auth.user?.is_admin;
  const [adminTestCredits, setAdminTestCredits] = useState(false);
  const adminBypass = isAdmin && !adminTestCredits;

  const immersionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleImmersionChange = useCallback(
    (next: ImmersionSettings) => {
      setImmersionSettings(next);
      applyImmersionToRoot(next);
      if (immersionSaveTimer.current) clearTimeout(immersionSaveTimer.current);
      immersionSaveTimer.current = setTimeout(async () => {
        immersionSaveTimer.current = null;
        try {
          await saveMasterImmersion(next);
          toast({ title: t("toast.globalSaved"), description: t("toast.globalSavedDesc") });
        } catch (e) {
          toast({
            title: t("toast.globalSaveError"),
            description: (e as Error).message || "Check API / database.",
            variant: "destructive",
          });
        }
      }, 650);
    },
    [toast],
  );

  useEffect(() => {
    if (!isAdmin) return;
    fetchMasterImmersion().then(setImmersionSettings);
  }, [isAdmin]);

  // Warm the lazy gallery chunk in the background so the chunk loader is brief on fast networks.
  useEffect(() => {
    void import("@/components/ResultsGrid");
  }, []);

  // Folders
  const foldersHook = useFolders();
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const prevResultsLenRef = useRef(0);

  const { history, addEntry, removeEntry, clearHistory } = usePromptHistory();
  const [activePrompt, setActivePrompt] = useState("");
  const [activeImageUrl, setActiveImageUrl] = useState("");

  // Pick up deep-link actions from URL params (Library edit/animate, shared prompts)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    const sharedPrompt = params.get("prompt");

    if (action === "edit") {
      const url = sessionStorage.getItem("library-edit-image");
      if (url) {
        setMode("edit-image");
        setActiveImageUrl(url);
        setActivePrompt("");
        sessionStorage.removeItem("library-edit-image");
      }
      window.history.replaceState({}, "", "/");
    } else if (action === "animate") {
      const url = sessionStorage.getItem("library-animate-image");
      if (url) {
        setMode("image-to-video");
        setActiveImageUrl(url);
        setActivePrompt("");
        sessionStorage.removeItem("library-animate-image");
      }
      window.history.replaceState({}, "", "/");
    } else if (sharedPrompt) {
      setActivePrompt(sharedPrompt);
      setMode("text-to-image");
      window.history.replaceState({}, "", "/");
    }
  }, []);

  // Engine selectors per mode — persisted per mode across sessions
  type EditEngine = "grok" | "gltch";
  type ComfyEngine = "grok" | "comfy" | "gltch";

  const [editEngine, setEditEngineRaw] = useState<EditEngine>(() => {
    const v = localStorage.getItem("engine-edit-image");
    return (v === "gltch") ? v : "gltch";
  });
  const setEditEngine = useCallback((v: EditEngine) => {
    localStorage.setItem("engine-edit-image", v);
    setEditEngineRaw(v);
  }, []);

  const [genEngine, setGenEngineRaw] = useState<ComfyEngine>(() => {
    const v = localStorage.getItem("engine-text-to-image");
    return (v === "comfy" || v === "gltch") ? v : "gltch";
  });
  const setGenEngine = useCallback((v: ComfyEngine) => {
    localStorage.setItem("engine-text-to-image", v);
    setGenEngineRaw(v);
  }, []);

  const [renderEngine, setRenderEngineRaw] = useState<ComfyEngine>(() => {
    const v = localStorage.getItem("engine-text-to-video");
    return (v === "comfy" || v === "gltch") ? v : "comfy";
  });
  const setRenderEngine = useCallback((v: ComfyEngine) => {
    localStorage.setItem("engine-text-to-video", v);
    setRenderEngineRaw(v);
  }, []);

  const [animateEngine, setAnimateEngineRaw] = useState<ComfyEngine>(() => {
    const v = localStorage.getItem("engine-image-to-video");
    return (v === "comfy" || v === "gltch") ? v : "gltch";
  });
  const setAnimateEngine = useCallback((v: ComfyEngine) => {
    localStorage.setItem("engine-image-to-video", v);
    setAnimateEngineRaw(v);
  }, []);

  const [grokPro, setGrokPro] = useState(false);

  const [gltchImage2, setGltchImage2] = useState<string | null>(null);
  const [gltchImage2Name, setGltchImage2Name] = useState("");
  const gltchImage2Ref = useRef<HTMLInputElement>(null);

  // ComfyUI settings
  const [comfyCheckpoint, setComfyCheckpoint] = useState("");
  const [comfyLora, setComfyLora] = useState("none");
  const [comfyLoraStrength, setComfyLoraStrength] = useState(0.30);
  const [comfyWidth, setComfyWidth] = useState(832);
  const [comfyHeight, setComfyHeight] = useState(480);
  const [comfyFrameCount, setComfyFrameCount] = useState(81);
  
  const [comfyVideoLora, setComfyVideoLora] = useState("none");
  const [comfyVideoLoraStrength, setComfyVideoLoraStrength] = useState(0.30);
  const [comfyVideoLoraPass, setComfyVideoLoraPass] = useState<"high" | "low" | "both">("high");
  const [comfyAudioMode, setComfyAudioMode] = useState<"none" | "ambient">("none");
  const [comfyAudioPrompt, setComfyAudioPrompt] = useState("");
  
  const [comfyEndFrameUrl, setComfyEndFrameUrl] = useState<string>("");

  // Shared seed (empty = random)
  const [globalSeed, setGlobalSeed] = useState("");

  // Z-Image settings
  const [zimageWidth, setZimageWidth] = useState(1024);
  const [zimageHeight, setZimageHeight] = useState(1024);
  const [zimageLora, setZimageLora] = useState("none");
  const [zimageLoraStrength, setZimageLoraStrength] = useState(0.30);

  // GLTCH edit LoRA settings
  const [editLora, setEditLora] = useState("none");
  const [editLoraStrength, setEditLoraStrength] = useState(0.30);

  // Shared negative prompt (all comfy workflows)
  const [negPrompt, setNegPrompt] = useState("");

  // LongLook settings
  const [longLookEnabled, setLongLookEnabled] = useState(false);
  const [longLookSeqCount, setLongLookSeqCount] = useState(2);
  const [longLookFrameCount, setLongLookFrameCount] = useState(81);
  const [longLookMotionScale, setLongLookMotionScale] = useState(1.5);

  // Fetch ComfyUI models on mount
  React.useEffect(() => {
    if (auth.isAuthenticated) fetchComfyModels();
  }, [auth.isAuthenticated, fetchComfyModels]);

  // Auto-select first checkpoint when models load
  React.useEffect(() => {
    if (comfyModels.checkpoints.length > 0 && !comfyCheckpoint) {
      setComfyCheckpoint(comfyModels.checkpoints[0]);
    }
  }, [comfyModels.checkpoints, comfyCheckpoint]);

  // Legal & guide dialog state
  const [tosOpen, setTosOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => isAgeVerified() && !localStorage.getItem("how-to-use-seen"));
  const [changelogOpen, setChangelogOpen] = useState(() => {
    if (!isAgeVerified()) return false;
    // Auto-show changelog only if the user has already seen the guide (not first visit)
    if (!localStorage.getItem("how-to-use-seen")) return false;
    return hasUnseenChangelog();
  });
  const [storeOpen, setStoreOpen] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(() => hasApiKey());

  React.useEffect(() => {
    if (isAgeVerified()) return;

    const handleAgeVerified = () => {
      if (!localStorage.getItem("how-to-use-seen")) {
        setGuideOpen(true);
        return;
      }

      if (hasUnseenChangelog()) {
        setChangelogOpen(true);
      }
    };

    window.addEventListener(AGE_VERIFIED_EVENT, handleAgeVerified);
    return () => window.removeEventListener(AGE_VERIFIED_EVENT, handleAgeVerified);
  }, []);

  // Auto-switch to credits mode when user logs in without a BYOK key,
  // or when simple mode is active (simple mode always uses credits)
  const canUseCredits = auth.isAuthenticated && creditsHook.enabled;
  React.useEffect(() => {
    if (canUseCredits && apiMode === "byok" && (simpleMode || !apiKeySet)) {
      setApiMode("credits");
    }
  }, [canUseCredits, apiKeySet, apiMode, setApiMode, simpleMode]);
  const effectiveApiMode = apiMode;

  const handleSaveApiKey = useCallback((key: string) => {
    setApiKeyRaw(key);
    setApiKeySet(true);
  }, [setApiKeyRaw]);

  const handleClearApiKey = useCallback(() => {
    clearApiKeyRaw();
    setApiKeySet(false);
  }, [clearApiKeyRaw]);

  const handleSelectPrompt = useCallback((prompt: string) => {
    setActivePrompt(prompt);
  }, []);

  const handleEditImage = useCallback((imageUrl: string) => {
    setMode("edit-image");
    setActiveImageUrl(imageUrl);
    setActivePrompt("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast({ title: t("toast.editMode"), description: t("toast.editModeDesc") });
  }, [toast]);

  const handleAnimateImage = useCallback((imageUrl: string) => {
    setMode("image-to-video");
    setActiveImageUrl(imageUrl);
    setActivePrompt("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast({ title: t("toast.animateMode"), description: t("toast.animateModeDesc") });
  }, [toast]);

  const handleRedditClaim = useCallback(async () => {
    if (!redditCode.trim()) return;
    setRedditClaimLoading(true);
    setRedditClaimError("");
    try {
      await apiFetch("/reddit-reward", { method: "POST", body: { code: redditCode.trim() } });
      setRedditRewardClaimed(true);
      setRedditRewardDismissed(true);
      localStorage.setItem("reddit_reward_dismissed", "1");
      creditsHook.refreshCredits();
      toast({ title: "10 credits claimed!", description: "Thanks for joining r/GrokRunner." });
    } catch (err: any) {
      setRedditClaimError(err.message || "Failed to claim");
    } finally {
      setRedditClaimLoading(false);
    }
  }, [redditCode, creditsHook, toast]);

  const handleGltchImage2 = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let sourceBlob: Blob = file;
      const t = (file.type || "").toLowerCase();
      const n = (file.name || "").toLowerCase();
      if (t === "image/heic" || t === "image/heif" || n.endsWith(".heic") || n.endsWith(".heif")) {
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        sourceBlob = Array.isArray(converted) ? converted[0] : converted;
      }
      const bitmap = await createImageBitmap(sourceBlob);
      const maxDim = 1024;
      let w = bitmap.width, h = bitmap.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale); h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      setGltchImage2(canvas.toDataURL("image/jpeg", 0.9));
      setGltchImage2Name(file.name.replace(/\.[^.]+$/, "") + ".jpg");
    } catch {
      toast({ title: t("toast.imageError"), description: t("toast.imageErrorDesc"), variant: "destructive" });
    }
  }, [toast]);

  const clearGltchImage2 = useCallback(() => {
    setGltchImage2(null);
    setGltchImage2Name("");
    if (gltchImage2Ref.current) gltchImage2Ref.current.value = "";
  }, []);

  // When a result is moved to a folder, persist to IndexedDB + update React state
  const handleMoveToFolder = useCallback(async (resultId: string, folderId: string | null) => {
    try {
      await foldersHook.moveToFolder(resultId, folderId);
      updateResultFolder(resultId, folderId);
    } catch {
      toast({ title: t("toast.folderError"), description: t("toast.folderErrorDesc"), variant: "destructive" });
    }
  }, [foldersHook, updateResultFolder, toast]);

  const handleBulkMoveToFolder = useCallback(async (ids: string[], folderId: string | null) => {
    try {
      await foldersHook.bulkMoveToFolder(ids, folderId);
      for (const id of ids) updateResultFolder(id, folderId);
    } catch {
      toast({ title: t("toast.folderError"), description: t("toast.folderErrorBulkDesc"), variant: "destructive" });
    }
  }, [foldersHook, updateResultFolder, toast]);

  const handleBulkDelete = useCallback(async (ids: string[]) => {
    try {
      await foldersHook.bulkDelete(ids);
      for (const id of ids) deleteResult(id);
    } catch {
      toast({ title: t("toast.deleteError"), description: t("toast.deleteErrorDesc"), variant: "destructive" });
    }
  }, [foldersHook, deleteResult, toast]);

  const handleEmptyTrash = useCallback(async () => {
    try {
      const deletedIds = await foldersHook.emptyTrashFolder();
      for (const id of deletedIds) deleteResult(id);
    } catch {
      toast({ title: t("toast.trashError"), description: t("toast.trashErrorDesc"), variant: "destructive" });
    }
  }, [foldersHook, deleteResult, toast]);

  // Auto-move newly generated results into the selected target folder
  React.useEffect(() => {
    if (!targetFolderId || !storageReady) return;
    const newCount = results.length;
    const prevCount = prevResultsLenRef.current;
    if (newCount > prevCount) {
      const added = results.slice(0, newCount - prevCount);
      for (const r of added) {
        if (!r.folderId) {
          handleMoveToFolder(r.id, targetFolderId);
        }
      }
    }
    prevResultsLenRef.current = newCount;
  }, [results.length, targetFolderId, storageReady, results, handleMoveToFolder]);

  // Sync ref when storage first loads
  React.useEffect(() => {
    if (storageReady) prevResultsLenRef.current = results.length;
  }, [storageReady, results.length]);

  // Show results walkthrough tip after first generation in simple mode
  const prevResultsCountForTip = useRef(results.length);
  React.useEffect(() => {
    if (!simpleMode || hasShownResultsTip.current) return;
    if (results.length > prevResultsCountForTip.current && results.length > 0) {
      setShowResultsTip(true);
      hasShownResultsTip.current = true;
      localStorage.setItem("results-tip-seen", "1");
      // Auto-scroll to results
      setTimeout(() => {
        document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
    prevResultsCountForTip.current = results.length;
  }, [results.length, simpleMode]);

  // Preview credit cost shown on the GENERATE button
  const previewCreditCost = React.useMemo((): number | undefined => {
    if (effectiveApiMode !== "credits") return undefined;
    const isGrokEdit = mode === "edit-image" && editEngine === "grok";
    const isGltchEdit = mode === "edit-image" && editEngine === "gltch";
    const isZimage = mode === "text-to-image" && genEngine === "gltch";
    const isComfyGen = mode === "text-to-image" && genEngine === "comfy";
    const isGrokRender = mode === "text-to-video" && renderEngine === "grok";
    const isComfyRender = mode === "text-to-video" && renderEngine === "comfy";
    const isGltchWan = mode === "image-to-video" && animateEngine === "gltch";
    const isGrokAnimate = mode === "image-to-video" && animateEngine === "grok";
    const isComfyAnimate = mode === "image-to-video" && animateEngine === "comfy" && !longLookEnabled;
    const isComfyLongLook = mode === "image-to-video" && animateEngine === "comfy" && longLookEnabled;

    if (isGrokEdit) {
      const is2k = (settings.resolution || "1k") === "2k";
      const m: CreditMode = grokPro && is2k ? "edit-image-pro-2k" : grokPro ? "edit-image-pro" : is2k ? "edit-image-2k" : "edit-image";
      return calculateCreditCost(m, settings.count);
    }
    if (isGltchEdit) return calculateCreditCost("comfy-image");
    if (isZimage || isComfyGen) return calculateCreditCost("comfy-image");
    if (isComfyRender || isComfyAnimate || isGltchWan) return calculateCreditCost("comfy-video");
    if (isGrokRender || isGrokAnimate) return calculateCreditCost("text-to-video", 1, videoSettings.duration);
    if (isComfyLongLook) return calculateCreditCost("comfy-longlook", longLookSeqCount);
    // Grok generate (text-to-image)
    const is2k = (settings.resolution || "1k") === "2k";
    const cm: CreditMode = grokPro && is2k ? "text-to-image-pro-2k" : grokPro ? "text-to-image-pro" : is2k ? "text-to-image-2k" : "text-to-image";
    return calculateCreditCost(cm, settings.count);
  }, [mode, editEngine, genEngine, renderEngine, animateEngine, longLookEnabled, settings, grokPro, longLookSeqCount, videoSettings.duration, effectiveApiMode]);

  const handleSubmit = async (data: { prompt: string; imageUrl?: string; extraImageUrls?: string[] }) => {
    // Determine which engine pathway
    const isGrokEdit = mode === "edit-image" && editEngine === "grok";
    const isGltchEdit = mode === "edit-image" && editEngine === "gltch";
    const isZimage = mode === "text-to-image" && genEngine === "gltch";
    const isComfyGen = mode === "text-to-image" && genEngine === "comfy";
    const isComfyRender = mode === "text-to-video" && renderEngine === "comfy";
    const isGltchWan = mode === "image-to-video" && animateEngine === "gltch";
    const isComfyAnimate = mode === "image-to-video" && animateEngine === "comfy" && !longLookEnabled;
    const isComfyLongLook = mode === "image-to-video" && animateEngine === "comfy" && longLookEnabled;
    const isComfy = isZimage || isComfyGen || isGltchEdit || isGltchWan || isComfyRender || isComfyAnimate || isComfyLongLook;
    // Grok edit in BYOK mode uses the user's own API key directly — no credits needed
    const isGrokEditByok = isGrokEdit && effectiveApiMode === "byok" && apiKeySet;
    const isQueued = isGrokEdit || isGltchEdit || isComfy;

    // Check access: need either API key (BYOK) or credits
    if (!isQueued && effectiveApiMode === "byok" && !apiKeySet) {
      toast({
        title: t("toast.apiKeyRequired"),
        description: t("toast.apiKeyRequiredDesc"),
        variant: "destructive",
      });
      return;
    }

    // Grok edit in BYOK mode — just need an API key, no auth/credits
    if (isGrokEditByok) {
      // Skip auth and credit checks — falls through to the queued job section below
    } else if (isQueued) {
      // All other queued jobs require auth (server-side processing)
      if (!auth.isAuthenticated) {
        toast({
          title: t("toast.accountRequired"),
          description: t("toast.accountRequiredDesc"),
          variant: "destructive",
        });
        return;
      }
    }

    if ((effectiveApiMode === "credits" || isQueued) && !isGrokEditByok && !adminBypass) {
      if (!auth.isAuthenticated) {
        toast({ title: t("toast.accessDenied"), description: t("toast.accessDeniedDesc"), variant: "destructive" });
        return;
      }

      // Calculate cost
      let cost: number;
      if (isGrokEdit) {
        const is2k = (settings.resolution || "1k") === "2k";
        let editMode: CreditMode;
        if (grokPro && is2k) editMode = "edit-image-pro-2k";
        else if (grokPro) editMode = "edit-image-pro";
        else if (is2k) editMode = "edit-image-2k";
        else editMode = "edit-image";
        cost = calculateCreditCost(editMode, settings.count);
      } else if (isGltchEdit) {
        cost = calculateCreditCost("comfy-image");
      } else if (isZimage || isComfyGen) {
        cost = calculateCreditCost("comfy-image");
      } else if (isComfyLongLook) {
        cost = calculateCreditCost("comfy-longlook", longLookSeqCount);
      } else if (isGltchWan) {
        cost = calculateCreditCost("comfy-video");
      } else if (isComfyRender || isComfyAnimate) {
        cost = calculateCreditCost("comfy-video");
      } else {
        const isImageMode = mode === "text-to-image" || mode === "edit-image";
        const imageCount = isImageMode ? settings.count : 1;
        const videoDuration = (mode === "text-to-video" || mode === "image-to-video" || mode === "edit-video") ? videoSettings.duration : 0;
        const is2k = (settings.resolution || "1k") === "2k";
        let creditMode: CreditMode;
        if (isImageMode && grokPro && is2k) creditMode = (mode === "text-to-image" ? "text-to-image-pro-2k" : "edit-image-pro-2k") as CreditMode;
        else if (isImageMode && grokPro) creditMode = (mode === "text-to-image" ? "text-to-image-pro" : "edit-image-pro") as CreditMode;
        else if (isImageMode && is2k) creditMode = (mode === "text-to-image" ? "text-to-image-2k" : "edit-image-2k") as CreditMode;
        else creditMode = mode;
        cost = calculateCreditCost(creditMode, imageCount, videoDuration);
      }

      if (!creditsHook.hasEnoughCredits(cost)) {
        toast({
          title: t("toast.insufficientCredits"),
          description: t("toast.insufficientCreditsDesc", { cost }),
          variant: "destructive",
        });
        return;
      }
    }

    addEntry(data.prompt, mode);
    setActivePrompt("");

    // Yield to browser so loading UI paints before heavy image processing
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // ── Queued jobs (fire-and-forget with optimistic credit deduction) ──
    if (isQueued) {
      // Deduct credits optimistically before firing the job (skip for BYOK grok edit)
      if (!adminBypass && !isGrokEditByok) {
        let cost: number;
        if (isGrokEdit) cost = calculateCreditCost(grokPro ? "edit-image-pro" : "edit-image", settings.count);
        else if (isGltchEdit) cost = calculateCreditCost("comfy-image");
        else if (isGltchWan) cost = calculateCreditCost("comfy-video");
        else if (isZimage || isComfyGen) cost = calculateCreditCost("comfy-image");
        else if (isComfyLongLook) cost = calculateCreditCost("comfy-longlook", longLookSeqCount);
        else cost = calculateCreditCost("comfy-video");
        creditsHook.deductCreditsLocally(cost);
        setTimeout(() => creditsHook.refreshCredits(), 5000);
      }

      try {
        if (isGrokEdit) {
          grokEditQueued({
            prompt: data.prompt,
            image_url: data.imageUrl!,
            extra_image_urls: data.extraImageUrls,
            settings,
            pro: grokPro,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isGltchEdit) {
          const imageBase64 = data.imageUrl!.startsWith("data:")
            ? data.imageUrl!
            : await urlToBase64(data.imageUrl!);
          const round8 = (v: number) => Math.round(v / 8) * 8;
          let w: number, h: number;
          if (comfyWidth > 0 && comfyHeight > 0) {
            w = comfyWidth;
            h = comfyHeight;
          } else {
            const dim = await getImageDimensions(imageBase64);
            const maxDim = 1024;
            w = dim.width;
            h = dim.height;
            if (w > maxDim || h > maxDim) {
              const scale = maxDim / Math.max(w, h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
          }
          const parsedSeed = globalSeed ? Number(globalSeed) : undefined;
          comfyEdit({
            prompt: data.prompt,
            negativePrompt: negPrompt || undefined,
            imageBase64,
            imageBase64_2: gltchImage2 || undefined,
            imageFilename2: gltchImage2Name || undefined,
            width: round8(Math.max(256, w)),
            height: round8(Math.max(256, h)),
            steps: 4, cfg: 1,
            seed: parsedSeed,
            loras: editLora !== "none" ? [{ name: editLora, strengthModel: editLoraStrength, strengthClip: editLoraStrength }] : undefined,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isZimage) {
          const parsedSeed = globalSeed ? Number(globalSeed) : undefined;
          comfyGenerate({
            prompt: data.prompt,
            negativePrompt: negPrompt || undefined,
            workflow: "zimage",
            width: zimageWidth,
            height: zimageHeight,
            steps: 8,
            cfg: 1,
            seed: parsedSeed,
            lora: zimageLora !== "none" ? zimageLora : undefined,
            loraStrength: zimageLoraStrength,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isComfyGen) {
          const parsedSeed = globalSeed ? Number(globalSeed) : undefined;
          comfyGenerate({
            prompt: data.prompt,
            negativePrompt: negPrompt || undefined,
            checkpoint: comfyCheckpoint,
            lora: comfyLora !== "none" ? comfyLora : undefined,
            loraStrength: comfyLoraStrength,
            width: 832, height: 1024,
            steps: 4, cfg: 1,
            seed: parsedSeed,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isComfyRender) {
          comfyTextToVideo({
            prompt: data.prompt,
            negativePrompt: negPrompt || undefined,
            width: 832, height: 480,
            steps: 4, cfg: 1,
            frameCount: comfyFrameCount,
            resolution: 832, shift: 8,
            useRife: true, useUpscale: true,
            videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
            videoLoraStrength: comfyVideoLoraStrength,
            videoLoraPass: comfyVideoLoraPass,
            audioMode: comfyAudioMode,
            audioPrompt: comfyAudioPrompt || undefined,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isComfyLongLook) {
          const imageBase64 = data.imageUrl?.startsWith("data:")
            ? data.imageUrl
            : data.imageUrl ? await urlToBase64(data.imageUrl) : "";
          if (!imageBase64) throw new Error("Image is required for LongLook");
          const dim = await getImageDimensions(imageBase64);
          const round8 = (v: number) => Math.round(v / 8) * 8;
          const maxDim = 1024;
          let w = dim.width, h = dim.height;
          if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          const parsedSeedLL = globalSeed ? Number(globalSeed) : undefined;
          comfyLongLook({
            prompt: data.prompt,
            negativePrompt: negPrompt || undefined,
            imageBase64,
            width: round8(Math.max(256, w)),
            height: round8(Math.max(256, h)),
            sequenceCount: longLookSeqCount,
            frameCount: longLookFrameCount,
            steps: 4, cfg: 1,
            seed: parsedSeedLL,
            motionScale: longLookMotionScale,
            useRife: true, useUpscale: true,
            videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
            videoLoraStrength: comfyVideoLoraStrength,
            videoLoraPass: comfyVideoLoraPass,
            audioMode: comfyAudioMode,
            audioPrompt: comfyAudioPrompt || undefined,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isGltchWan) {
          const imageBase64 = data.imageUrl?.startsWith("data:")
            ? data.imageUrl
            : data.imageUrl ? await urlToBase64(data.imageUrl) : "";
          const parsedSeedWan = globalSeed ? Number(globalSeed) : undefined;

          if (imageBase64) {
            // Process optional end frame
            const endFrameBase64 = comfyEndFrameUrl?.startsWith("data:")
              ? comfyEndFrameUrl
              : comfyEndFrameUrl ? await urlToBase64(comfyEndFrameUrl) : "";

            // Image-to-Video: direct WAN I2V
            comfyVideo({
              prompt: data.prompt,
              negativePrompt: negPrompt || undefined,
              imageBase64,
              ...(endFrameBase64 ? { imageBase64_2: endFrameBase64, imageFilename2: "end_frame.png" } : {}),
              width: 832, height: 832,
              frameCount: comfyFrameCount,
              steps: 4, cfg: 1,
              seed: parsedSeedWan,
              useRife: false, useUpscale: false,
              workflow: "gltch-wan",
              resolution: 832, shift: 8,
              videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
              videoLoraStrength: comfyVideoLoraStrength,
              videoLoraPass: comfyVideoLoraPass,
              audioMode: comfyAudioMode,
              audioPrompt: comfyAudioPrompt || undefined,
              ...(adminTestCredits ? { testCredits: true } : {}),
            });
          } else {
            // Text-to-Video: Z-Image Turbo → GLTCH WAN I2V
            comfyTextToVideo({
              prompt: data.prompt,
              negativePrompt: negPrompt || undefined,
              width: 832, height: 480,
              frameCount: comfyFrameCount,
              steps: 4, cfg: 1,
              resolution: 832, shift: 8,
              useRife: false, useUpscale: false,
              videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
              videoLoraStrength: comfyVideoLoraStrength,
              videoLoraPass: comfyVideoLoraPass,
              audioMode: comfyAudioMode,
              audioPrompt: comfyAudioPrompt || undefined,
              ...(adminTestCredits ? { testCredits: true } : {}),
            });
          }
        } else if (isComfyAnimate) {
          const imageBase64 = data.imageUrl?.startsWith("data:")
            ? data.imageUrl
            : data.imageUrl ? await urlToBase64(data.imageUrl) : "";
          if (!imageBase64) throw new Error("Image is required for animation");
          const dim = await getImageDimensions(imageBase64);
          const round8 = (v: number) => Math.round(v / 8) * 8;
          const maxDim = 1024;
          let w = dim.width, h = dim.height;
          if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          const parsedSeedAnim = globalSeed ? Number(globalSeed) : undefined;
          comfyVideo({
            prompt: data.prompt,
            negativePrompt: negPrompt || undefined,
            imageBase64,
            width: round8(Math.max(256, w)),
            height: round8(Math.max(256, h)),
            frameCount: comfyFrameCount,
            steps: 4, cfg: 1,
            seed: parsedSeedAnim,
            useRife: true, useUpscale: true,
            videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
            videoLoraStrength: comfyVideoLoraStrength,
            videoLoraPass: comfyVideoLoraPass,
            audioMode: comfyAudioMode,
            audioPrompt: comfyAudioPrompt || undefined,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        }
        toast({ title: t("toast.jobQueued"), description: t("toast.jobQueuedDesc") });
      } catch (err: any) {
        toast({ title: t("toast.systemError"), description: err.message || t("toast.systemErrorDefault"), variant: "destructive" });
      }
      return;
    }

    // ── Grok (blocking) ────────────────────────────────────────────────
    try {
      switch (mode) {
        case "text-to-image":
          await generateImage({ prompt: data.prompt, settings, pro: grokPro, ...(adminTestCredits ? { testCredits: true } : {}) });
          break;
        case "text-to-video":
          await generateVideo({ prompt: data.prompt, videoSettings, ...(adminTestCredits ? { testCredits: true } : {}) });
          break;
        case "image-to-video":
          await generateVideo({ prompt: data.prompt, image_url: data.imageUrl, videoSettings, ...(adminTestCredits ? { testCredits: true } : {}) });
          break;
        case "edit-video":
          await editVideo({ prompt: data.prompt, video_url: data.imageUrl!, ...(adminTestCredits ? { testCredits: true } : {}) });
          break;
      }

      // Optimistically deduct credits on success (admin bypass skips deduction)
      if (effectiveApiMode === "credits" && !adminBypass) {
        const isImageMode = mode === "text-to-image" || mode === "edit-image";
        const imageCount = isImageMode ? settings.count : 1;
        const videoDuration = (mode === "text-to-video" || mode === "image-to-video" || mode === "edit-video") ? videoSettings.duration : 0;
        const is2k = (settings.resolution || "1k") === "2k";
        let creditMode: CreditMode;
        if (isImageMode && grokPro && is2k) creditMode = (mode === "text-to-image" ? "text-to-image-pro-2k" : "edit-image-pro-2k") as CreditMode;
        else if (isImageMode && grokPro) creditMode = (mode === "text-to-image" ? "text-to-image-pro" : "edit-image-pro") as CreditMode;
        else if (isImageMode && is2k) creditMode = (mode === "text-to-image" ? "text-to-image-2k" : "edit-image-2k") as CreditMode;
        else creditMode = mode;
        const cost = calculateCreditCost(creditMode, imageCount, videoDuration);
        creditsHook.deductCreditsLocally(cost);
        setTimeout(() => creditsHook.refreshCredits(), 2000);
      }

      toast({
        title: t("toast.renderComplete"),
        description: t("toast.renderCompleteDesc"),
      });
    } catch (err: any) {
      const msg = err.message || "Generation failed.";
      const lines = msg.split("\n").filter((l: string) => l.trim());
      toast({
        title: t("toast.systemError"),
        description: lines[0],
        variant: "destructive",
        duration: lines.length > 1 ? 12000 : 5000,
      });
      if (lines.length > 1) {
        setTimeout(() => {
          toast({
            title: t("toast.hint"),
            description: lines.slice(1).join(" "),
            duration: 15000,
          });
        }, 500);
      }
    }
  };

  return (
    <CyberLayout>
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8 pb-24 sm:pb-8 space-y-4 sm:space-y-6">
        {/* Flash sale banner — sitewide */}
        <FlashSaleBanner onClick={() => setStoreOpen(true)} />

        {/* Verify email banner for unverified users */}
        {auth.isAuthenticated && auth.user && !auth.user.email_verified && (
          <div className="flex items-center gap-3 bg-secondary/10 border border-secondary/30 rounded-lg px-4 py-3 animate-slide-up">
            <AlertCircle className="w-4 h-4 text-secondary shrink-0" />
            <p className="font-mono-share text-xs text-secondary flex-1">
              {t("header.verifyEmailNotice")}
            </p>
            <button
              onClick={() => auth.requestVerification()}
              className="shrink-0 px-3 py-1.5 bg-secondary/20 border border-secondary/40 rounded text-[10px] font-mono-share text-secondary hover:bg-secondary/30 transition-colors"
            >
              {t("header.verifyNow")}
            </button>
          </div>
        )}

        {/* Top tabs: Feed / Create — keeps navigation symmetrical with the feed page */}
        <div className="flex items-center justify-center sm:justify-start">
          <div className="flex items-center gap-1 p-1 rounded-lg border border-border/40 bg-card/40 w-fit">
            <Link
              to="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md font-orbitron text-[10px] tracking-widest text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
            >
              <Rss className="w-3.5 h-3.5" /> FEED
            </Link>
            <button
              type="button"
              aria-current="page"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md font-orbitron text-[10px] tracking-widest bg-primary/15 text-primary border border-primary/40 shadow-[0_0_8px_hsl(var(--primary)/0.25)]"
            >
              <Zap className="w-3.5 h-3.5" /> CREATE
            </button>
          </div>
        </div>

        {/* Stories */}
        <StoriesBar currentUserId={auth.user?.id} isAdmin={auth.user?.is_admin} />

        {/* Header with Orb */}
        <header className="text-center space-y-2 animate-slide-up">
          {/* Grok Orb — hidden on mobile (shown in loading state instead), lazy-loaded */}
          <div className="hidden sm:block sm:w-48 sm:h-48 md:w-64 md:h-64 mx-auto">
            <Suspense fallback={<div className="w-full h-full rounded-full bg-primary/5 animate-pulse" />}>
              <GrokOrb isGenerating={isLoading} />
            </Suspense>
          </div>

          <GlitchText
            text="GROK_RUNNER"
            as="h1"
            className="font-orbitron text-2xl sm:text-3xl md:text-5xl font-black tracking-wider neon-text-cyan"
            glitchIntensity="medium"
          />
          <p className="font-mono-share text-xs sm:text-sm text-muted-foreground animate-flicker">
            <span className="text-primary/50">$</span> {t("header.subtitle")} // v{APP_VERSION}
            <span className="inline-block w-2 h-4 bg-primary/70 ml-1 animate-pulse align-middle" />
          </p>

          {/* Status bar */}
          <div className="flex items-center justify-center gap-2 sm:gap-4 font-mono-share text-[9px] sm:text-[10px] text-muted-foreground/50 pt-2 flex-wrap">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              {t("header.sysOnline")}
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"
                }`}
            />

            {/* API Mode toggle: BYOK vs Credits — hidden in simple mode */}
            {!simpleMode && (
              <div className="flex items-center bg-card/60 border border-border/50 rounded overflow-hidden">
                <button
                  onClick={() => setApiMode("byok")}
                  className={`flex items-center gap-1 px-2 py-1 text-[9px] sm:text-[10px] font-mono-share transition-colors ${effectiveApiMode === "byok"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                    }`}
                >
                  <Key className="w-2.5 h-2.5" />
                  {t("header.byok")}
                </button>
                {canUseCredits && (
                  <button
                    onClick={() => setApiMode("credits")}
                    className={`flex items-center gap-1 px-2 py-1 text-[9px] sm:text-[10px] font-mono-share transition-colors ${effectiveApiMode === "credits"
                      ? "bg-secondary/20 text-secondary"
                      : "text-muted-foreground/50 hover:text-muted-foreground"
                      }`}
                  >
                    <Coins className="w-2.5 h-2.5" />
                    {t("credits.credits")}
                  </button>
                )}
              </div>
            )}

            {/* BYOK: API key dialog — hidden in simple mode */}
            {!simpleMode && effectiveApiMode === "byok" && (
              <ApiKeyDialog
                hasKey={apiKeySet}
                onSave={handleSaveApiKey}
                onClear={handleClearApiKey}
              />
            )}


            {/* Credits: balance display — always visible in simple mode for authenticated users */}
            {(effectiveApiMode === "credits" || simpleMode) && canUseCredits && (
              <CreditDisplay
                totalCredits={creditsHook.totalCredits}
                dailyCredits={creditsHook.dailyCredits}
                subCredits={creditsHook.subCredits}
                packCredits={creditsHook.packCredits}
                subscriptionTier={creditsHook.subscriptionTier}
                subscriptionRenewsAt={creditsHook.subscriptionRenewsAt}
                subscriptionCancelAt={creditsHook.subscriptionCancelAt}
                loading={creditsHook.loading}
                purchasing={creditsHook.purchasing}
                purchaseError={creditsHook.purchaseError}
                clearPurchaseError={creditsHook.clearPurchaseError}
                packages={creditsHook.packages}
                subscriptionTiers={creditsHook.subscriptionTiers}
                onPurchase={creditsHook.purchaseCredits}
                onSubscribe={creditsHook.subscribeToPlan}
                onManageSubscription={creditsHook.manageSubscription}
                onCreditsRefresh={creditsHook.refreshCredits}
                externalOpen={storeOpen}
                onExternalOpenChange={setStoreOpen}
              />
            )}

            {/* Daily Missions */}
            {auth.isAuthenticated && (
              <DailyMissionsDialog
                status={missionsHook.status}
                loading={missionsHook.loading}
                claiming={missionsHook.claiming}
                onClaim={missionsHook.claimMission}
                onClaimStreak={missionsHook.claimStreakBonus}
                onCreditsRefresh={creditsHook.refreshCredits}
              />
            )}

            {/* Admin: test credit spending toggle */}
            {isAdmin && (
              <button
                onClick={() => setAdminTestCredits(prev => !prev)}
                className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${adminTestCredits
                  ? "border-yellow-500/60 bg-yellow-500/20 text-yellow-300"
                  : "border-white/10 bg-white/5 text-white/40 hover:text-white/60"
                  }`}
                title={adminTestCredits ? "Credits WILL be deducted (testing mode)" : "Credits are bypassed (admin mode)"}
              >
                {adminTestCredits ? "TEST CR: ON" : "TEST CR: OFF"}
              </button>
            )}

            {/* Theme Picker */}
            <ThemePicker />

            {/* Simple / Advanced toggle */}
            <div className="relative">
              <button
                onClick={() => {
                  const next = !simpleMode;
                  setSimpleMode(next);
                  localStorage.setItem("ui-mode", next ? "simple" : "advanced");
                  localStorage.setItem("onboarding-toggle-seen", "1");
                  setShowToggleTooltip(false);
                  if (next && !["edit-image", "text-to-image", "image-to-video"].includes(mode)) {
                    setMode("edit-image");
                  }
                }}
                className={`flex items-center gap-1 px-2 py-1 text-[9px] sm:text-[10px] font-mono-share transition-colors rounded border ${
                  simpleMode
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border/50 bg-card/40 text-muted-foreground/60 hover:text-muted-foreground"
                }${showToggleTooltip ? " ring-2 ring-primary/50 ring-offset-1 ring-offset-background" : ""}`}
                title={simpleMode ? t("header.switchToAdvanced") : t("header.switchToSimple")}
              >
                {simpleMode ? <ToggleLeft className="w-3 h-3" /> : <ToggleRight className="w-3 h-3" />}
                {simpleMode ? t("header.simple") : t("header.advanced")}
              </button>

              {/* First-time onboarding tooltip */}
              {showToggleTooltip && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 animate-slide-up">
                  <div className="relative bg-card border border-primary/40 rounded-lg px-3 py-2.5 shadow-lg shadow-primary/10 max-w-[220px]">
                    {/* Arrow */}
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-card border-l border-t border-primary/40" />
                    <p className="font-mono-share text-[10px] text-foreground/80 leading-relaxed relative z-10">
                      💡 <span className="text-primary font-bold">{t("header.onboardingNew")}</span> {t("header.onboardingTip")}
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowToggleTooltip(false);
                        localStorage.setItem("onboarding-toggle-seen", "1");
                      }}
                      className="mt-1.5 font-mono-share text-[9px] text-primary/60 hover:text-primary transition-colors relative z-10"
                    >
                      {t("header.onboardingGotIt")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Notification bell */}
            <NotificationBell isAuthenticated={auth.isAuthenticated} />

            {/* Auth: login/logout */}
            {auth.enabled && (
              <AuthDialog
                isAuthenticated={auth.isAuthenticated}
                userEmail={auth.user?.email}
                onSignIn={auth.signIn}
                onSignUp={auth.signUp}
                onSignOut={auth.signOut}
                pendingVerificationEmail={auth.pendingVerificationEmail}
                onVerify={auth.verifyEmail}
                onResendCode={auth.resendCode}
                onCancelVerification={auth.cancelVerification}
                pendingTwoFactorEmail={auth.pendingTwoFactorEmail}
                onVerifyTwoFactor={auth.verifyTwoFactor}
                onCancelTwoFactor={auth.cancelTwoFactor}
                onForgotPassword={auth.forgotPassword}
                onResetPassword={auth.resetPassword}
                onDeleteAccount={auth.deleteAccount}
              />
            )}
          </div>
        </header>

        {/* Value prop strip */}
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full group py-1">
            <span className="font-mono-share text-primary/40 text-[9px] group-data-[state=open]:text-primary/60">▸</span>
            <span className="font-mono-share text-[9px] tracking-widest text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">STATUS</span>
            <div className="h-px flex-1 bg-primary/5" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-1.5 animate-slide-up">
              {[
                { icon: "⚡", label: t("header.valueFast") },
                { icon: "🔞", label: t("header.valueNsfw") },
                { icon: "🎬", label: t("header.valueMedia") },
                { icon: "💳", label: t("header.valuePayPerCredit") },
              ].map(({ icon, label }) => (
                <span key={label} className="flex items-center gap-1 font-mono-share text-[10px] text-muted-foreground/50">
                  <span className="text-primary/60">{icon}</span>
                  {label}
                </span>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Announcements */}
        {visibleAnnouncements.length > 0 && (
          <div className="space-y-2 mb-4 animate-slide-up">
            {visibleAnnouncements.map(a => (
              <div
                key={a.id}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded border font-mono-share text-[10px] ${a.type === "warning"
                  ? "bg-amber-500/5 border-amber-500/30 text-amber-300"
                  : a.type === "success"
                    ? "bg-green-500/5 border-green-500/30 text-green-300"
                    : "bg-secondary/5 border-secondary/30 text-secondary"
                  }`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
                  {a.message}
                </span>
                <button
                  onClick={() => dismissAnnouncement(a.id)}
                  className="text-current/50 hover:text-current transition-colors flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Reddit reward banner */}
        {auth.isAuthenticated && !redditRewardDismissed && !redditRewardClaimed && (
          <div className="mb-4 animate-slide-up rounded border border-orange-500/30 bg-orange-500/5 px-4 py-3 font-mono-share">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Gift className="w-4 h-4 text-orange-400 flex-shrink-0" />
                <span className="text-[11px] text-orange-300">
                  Join{" "}
                  <a href="https://reddit.com/r/GrokRunner" target="_blank" rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-orange-200 transition-colors">
                    r/GrokRunner
                  </a>
                  {" "}and claim 10 free credits!
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!redditCodeOpen ? (
                  <button
                    onClick={() => setRedditCodeOpen(true)}
                    className="px-2.5 py-1 text-[10px] rounded border border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 transition-colors"
                  >
                    CLAIM
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setRedditRewardDismissed(true);
                    localStorage.setItem("reddit_reward_dismissed", "1");
                  }}
                  className="text-orange-400/50 hover:text-orange-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {redditCodeOpen && (
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="text"
                  value={redditCode}
                  onChange={e => { setRedditCode(e.target.value); setRedditClaimError(""); }}
                  onKeyDown={e => e.key === "Enter" && handleRedditClaim()}
                  placeholder="Enter code from subreddit..."
                  className="flex-1 px-2.5 py-1.5 rounded border border-orange-500/30 bg-background/50 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-orange-400/60"
                  disabled={redditClaimLoading}
                  autoFocus
                />
                <button
                  onClick={handleRedditClaim}
                  disabled={redditClaimLoading || !redditCode.trim()}
                  className="px-3 py-1.5 text-[10px] rounded border border-orange-500/40 bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 transition-colors disabled:opacity-40"
                >
                  {redditClaimLoading ? "..." : "SUBMIT"}
                </button>
              </div>
            )}
            {redditClaimError && (
              <p className="mt-1.5 text-[10px] text-red-400">{redditClaimError}</p>
            )}
          </div>
        )}

        {simpleMode ? (
          /* ── SIMPLE MODE ─────────────────────────────────────── */
          <section className="animate-slide-up border border-border rounded bg-card/40 backdrop-blur-sm overflow-hidden" style={{ animationDelay: "100ms" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-card/60">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-neon-red/60" />
                <div className="w-2 h-2 rounded-full bg-neon-yellow/60" />
                <div className="w-2 h-2 rounded-full bg-primary/60" />
              </div>
              <span className="font-orbitron text-sm sm:text-base font-bold text-foreground tracking-wide leading-tight">
                Quick Create
              </span>
              <div className={`w-2 h-2 rounded-full transition-colors duration-500 shrink-0 ml-auto ${isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"}`} />
            </div>
            <div className="p-3 sm:p-5">
              <SimpleMode
                onSubmit={handleSubmit}
                isLoading={isLoading}
                creditCost={previewCreditCost}
                totalCredits={effectiveApiMode === "credits" ? creditsHook.totalCredits : undefined}
                onModeChange={(m) => { setMode(m); setActiveImageUrl(""); }}
                onImageUrlChange={setActiveImageUrl}
                currentMode={mode}
              />
            </div>
          </section>
        ) : (
          /* ── ADVANCED MODE ───────────────────────────────────── */
          <>
        {/* Mode selector */}
        <section className="animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono-share text-primary/40 text-xs">❯</span>
            <GlitchText
              text="SELECT_MODE"
              className="font-orbitron text-[10px] tracking-widest text-muted-foreground"
              glitchIntensity="low"
            />
            <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
            <Link
              to="/"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-secondary/30 hover:border-secondary/60 bg-secondary/5 hover:bg-secondary/10 transition-all font-mono-share text-[10px] text-secondary/80 hover:text-secondary tracking-wider"
              title="Browse community feed"
            >
              <Rss className="w-3 h-3" />
              FEED
            </Link>
          </div>
          <ModeSelector activeMode={mode} onModeChange={(m) => { setMode(m); setActiveImageUrl(""); }} isAuthenticated={auth.isAuthenticated} />
        </section>

        {/* Prompt form — Terminal block */}
        <section
          className="relative border border-border rounded bg-card/40 backdrop-blur-sm animate-slide-up overflow-hidden"
          style={{ animationDelay: "200ms" }}
        >
          {/* Terminal title bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-card/60">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-neon-red/60" />
              <div className="w-2 h-2 rounded-full bg-neon-yellow/60" />
              <div className="w-2 h-2 rounded-full bg-primary/60" />
            </div>
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 ml-1">
              <span className="font-orbitron text-sm sm:text-base font-bold text-foreground tracking-wide leading-tight">
                Describe what you want to create
              </span>
              <span className="font-mono-share text-[10px] text-muted-foreground/50 hidden sm:inline">
                — images, video, edits
              </span>
            </div>
            <div className={`w-2 h-2 rounded-full transition-colors duration-500 shrink-0 ${isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"}`} />
          </div>

          {/* Terminal body */}
          <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">


            <SettingsPanel 
              settings={settings} 
              videoSettings={videoSettings} 
              immersionSettings={immersionSettings}
              onChange={handleSettingsChange} 
              onVideoChange={handleVideoSettingsChange}
              onImmersionChange={isAdmin ? handleImmersionChange : undefined}
              isAdmin={isAdmin}
              mode={mode} 
            />

            {/* 3-step flow guide */}
            <div className="flex items-center gap-0 font-mono-share text-[9px] select-none overflow-x-auto">
              {[
                { n: "1", label: "Mode" },
                { n: "2", label: "Prompt" },
                { n: "3", label: "Engine → Generate" },
              ].map((step, i) => (
                <React.Fragment key={step.n}>
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded shrink-0 ${
                    i === 0 ? "bg-primary/10 border border-primary/25 text-primary/80"
                    : i === 1 ? "bg-primary/5 border border-primary/15 text-primary/50"
                    : "bg-secondary/5 border border-secondary/20 text-secondary/70"
                  }`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 ${
                      i === 0 ? "bg-primary/20 text-primary"
                      : i === 1 ? "bg-primary/10 text-primary/60"
                      : "bg-secondary/20 text-secondary"
                    }`}>
                      {step.n}
                    </span>
                    <span className="tracking-wider">{step.label}</span>
                  </div>
                  {i < 2 && <span className="text-border/60 px-1 shrink-0">→</span>}
                </React.Fragment>
              ))}
            </div>

            {/* Engine + mode settings (collapsible) */}
            <Collapsible defaultOpen={false} className="rounded-md overflow-hidden">
              <CollapsibleTrigger className="flex items-center gap-2 w-full group py-1.5">
                <span className="font-mono-share text-primary/40 text-[9px] group-data-[state=open]:text-primary/60">▸</span>
                <Zap className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors group-data-[state=open]:text-primary" />
                <span className="font-mono-share text-[10px] tracking-widest text-muted-foreground group-hover:text-primary transition-colors group-data-[state=open]:text-primary">
                  ENGINE_CONFIG
                </span>
                <div className="h-px flex-1 bg-primary/10" />
                <span className="font-mono-share text-[9px] text-muted-foreground/30">
                  {mode === "edit-image" ? editEngine : mode === "text-to-image" ? genEngine : mode === "text-to-video" ? renderEngine : animateEngine}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-3 animate-slide-up">

            {/* Engine selector — shows in edit-image mode */}
            {mode === "edit-image" && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditEngine("gltch"); fetchComfyModels(); }}
                    className={`
                      p-2.5 border rounded text-left transition-all duration-200
                      ${editEngine === "gltch"
                        ? "border-secondary neon-border bg-secondary/5"
                        : "border-border bg-card/30 hover:border-secondary/40"
                      }
                    `}
                  >
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${editEngine === "gltch" ? "text-secondary" : "text-foreground"}`}>
                      GLTCH
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-red-400/80 border-red-500/30 bg-red-500/10 animate-pulse">RAW</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>Edit + LoRA</span>
                      <span className={editEngine === "gltch" ? "text-secondary/70" : "text-muted-foreground/50"}>
                        3 cr
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditEngine("grok")}
                    className={`
                      p-2.5 border rounded text-left transition-all duration-200
                      ${editEngine === "grok"
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                      }
                    `}
                  >
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${editEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI Edit</span>
                      <span className={editEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>
                        6 cr
                      </span>
                    </div>
                  </button>
                </div>

                {/* GLTCH edit controls — LoRA selector + upscale */}
                {editEngine === "gltch" && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/5 border border-secondary/20 rounded">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                      <span className="font-mono-share text-[9px] text-secondary/70">
                        2 cr/edit — Flux 2 Klein Edit + LoRA
                      </span>
                    </div>
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">OUTPUT SIZE</label>
                      <div className="grid grid-cols-4 gap-1">
                        {([
                          [0, 0, "AUTO"],
                          [1024, 1024, "1:1"],
                          [768, 1024, "3:4"],
                          [1024, 768, "4:3"],
                          [768, 1360, "9:16"],
                          [1360, 768, "16:9"],
                          [832, 1216, "2:3"],
                          [1216, 832, "3:2"],
                        ] as [number, number, string][]).map(([w, h, label]) => (
                          <button key={`qe-${w}x${h}`} type="button"
                            onClick={() => { setComfyWidth(w); setComfyHeight(h); }}
                            className={`px-1.5 py-1 rounded text-center font-mono-share text-[9px] border transition-all
                              ${comfyWidth === w && comfyHeight === h
                                ? "border-purple-500 bg-purple-500/10 text-purple-400"
                                : "border-border bg-card/30 text-muted-foreground hover:border-purple-500/40"
                              }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="font-mono-share text-[8px] text-muted-foreground/50 mt-1">AUTO = match input image</p>
                    </div>
                    
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground mb-1 block">SECOND IMAGE (OPTIONAL)</label>
                      {gltchImage2 ? (
                        <div className="relative">
                          <img
                            src={gltchImage2}
                            alt="Reference 2"
                            className="w-full max-h-36 object-contain rounded border border-purple-500/20 bg-black/60"
                          />
                          <button
                            type="button"
                            onClick={clearGltchImage2}
                            className="absolute top-1 right-1 p-1 bg-black/80 rounded-full text-red-400 hover:text-red-300"
                            title="Remove second image"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => gltchImage2Ref.current?.click()}
                          className="w-full flex items-center justify-center gap-2 px-3 py-3 bg-black/60 border border-dashed border-purple-500/30 rounded text-xs font-mono-share text-purple-400/60 hover:border-purple-400/50 hover:text-purple-300 transition-colors"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Add reference image
                        </button>
                      )}
                      <input
                        ref={gltchImage2Ref}
                        type="file"
                        accept="image/*,.heic,.heif"
                        onChange={handleGltchImage2}
                        className="hidden"
                      />
                    </div>

                    {comfyModels.editLoras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">LoRA (optional)</label>
                        <select value={editLora} onChange={(e) => {
                          if (isNsfwLora(e.target.value) && !comfyModels.xrgeHolder && e.target.value !== "none") return;
                          setEditLora(e.target.value);
                        }}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.editLoras.map((l) => (
                            <option key={l} value={l}
                              disabled={isNsfwLora(l) && !comfyModels.xrgeHolder}
                              style={isNsfwLora(l) && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                              {isNsfwLora(l) && !comfyModels.xrgeHolder ? "🔒 " : ""}{l.replace(/\.[^.]+$/, "")}
                            </option>
                          ))}
                        </select>
                        {editLora !== "none" && (
                          <div className="mt-1.5">
                            <label className="font-mono-share text-[8px] text-muted-foreground/60 flex items-center justify-between">
                              <span>STRENGTH</span>
                              <span>{editLoraStrength.toFixed(1)}</span>
                            </label>
                            <input type="range" min="0" max="2" step="0.1" value={editLoraStrength}
                              onChange={(e) => setEditLoraStrength(Number(e.target.value))}
                              className="w-full h-1 accent-secondary" />
                          </div>
                        )}
                        {!comfyModels.xrgeHolder && comfyModels.editLoras.some(isNsfwLora) && (
                          <div className="font-mono-share text-[8px] text-pink-400/60 mt-1 space-y-1">
                            <p>🔒 NSFW LoRAs require unlock</p>
                            <button
                              onClick={() => creditsHook.purchaseLoraUnlock()}
                              disabled={creditsHook.purchasing}
                              className="px-2 py-1 rounded text-[9px] font-mono-share bg-pink-500/20 border border-pink-500/40 text-pink-300 hover:bg-pink-500/30 transition-colors disabled:opacity-50"
                            >
                              {creditsHook.purchasing ? "..." : "UNLOCK ALL LORAS — $30"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Engine selector — GENERATE mode */}
            {mode === "text-to-image" && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className={`grid ${isAdmin ? "grid-cols-3" : "grid-cols-2"} gap-2`}>
                  <button type="button" onClick={() => setGenEngine("gltch")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${genEngine === "gltch" ? "border-secondary neon-border bg-secondary/5" : "border-border bg-card/30 hover:border-secondary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${genEngine === "gltch" ? "text-secondary" : "text-foreground"}`}>
                      GLTCH
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-red-400/80 border-red-500/30 bg-red-500/10 animate-pulse">RAW</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>Z-Image Turbo</span>
                      <span className={genEngine === "gltch" ? "text-secondary/70" : "text-muted-foreground/50"}>3 cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => setGenEngine("grok")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${genEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${genEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI Image</span>
                      <span className={genEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>4 cr</span>
                    </div>
                  </button>
                  {isAdmin && (
                    <button type="button" onClick={() => setGenEngine("comfy")}
                      className={`p-2.5 border rounded text-left transition-all duration-200 ${genEngine === "comfy" ? "border-purple-500 bg-purple-500/5 shadow-[0_0_8px_rgba(168,85,247,0.15)]" : "border-border bg-card/30 hover:border-purple-500/40"}`}>
                      <div className={`font-orbitron text-[11px] ${genEngine === "comfy" ? "text-purple-400" : "text-foreground"}`}>COMFY</div>
                      <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5">Admin</div>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Engine selector — RENDER (text-to-video) mode */}
            {mode === "text-to-video" && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRenderEngine("comfy")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${renderEngine === "comfy" ? "border-purple-500 bg-purple-500/5 shadow-[0_0_8px_rgba(168,85,247,0.15)]" : "border-border bg-card/30 hover:border-purple-500/40"}`}>
                    <div className={`font-orbitron text-[11px] ${renderEngine === "comfy" ? "text-purple-400" : "text-foreground"}`}>COMFY</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>WAN Video</span>
                      <span className={renderEngine === "comfy" ? "text-purple-400/70" : "text-muted-foreground/50"}>15 cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => setRenderEngine("grok")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${renderEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${renderEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI Video</span>
                      <span className={renderEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>6 cr/s</span>
                    </div>
                  </button>
                </div>

                {/* Comfy RENDER settings */}
                {renderEngine === "comfy" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/5 border border-purple-500/20 rounded">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                      <span className="font-mono-share text-[9px] text-purple-400/70">
                        WAN 2.2 advanced mode — heavier post-processing
                      </span>
                    </div>
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Duration</label>
                      <div className="flex flex-wrap gap-1.5">
                        {[{ label: "~2s", value: 33 }, { label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }, { label: "~10s", value: 161 }, { label: "~15s", value: 241 }].map((p) => (
                          <button key={p.value} type="button" onClick={() => setComfyFrameCount(p.value)}
                            className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyFrameCount === p.value ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {comfyModels.videoLoras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Video LoRA (optional)</label>
                        <select value={comfyVideoLora} onChange={(e) => {
                          const entry = comfyModels.videoLoras.find(v => v.name === e.target.value);
                          if (entry?.nsfw && !comfyModels.xrgeHolder) return;
                          setComfyVideoLora(e.target.value);
                        }}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.videoLoras.map((entry) => (
                            <option key={entry.name} value={entry.name}
                              disabled={!!entry.nsfw && !comfyModels.xrgeHolder}
                              style={entry.nsfw && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                              {entry.nsfw && !comfyModels.xrgeHolder ? `🔒 ${entry.displayName || entry.name.replace(/_/g, " ")}` : (entry.displayName || entry.name.replace(/_/g, " "))}{entry.high && entry.low ? " (paired)" : ""}
                            </option>
                          ))}
                        </select>
                        {!comfyModels.xrgeHolder && comfyModels.videoLoras.some(v => v.nsfw) && (
                          <div className="mt-1 font-mono-share text-[8px] text-pink-400/70 space-y-1">
                            <p>🔒 NSFW LoRAs require unlock</p>
                            <button
                              onClick={() => creditsHook.purchaseLoraUnlock()}
                              disabled={creditsHook.purchasing}
                              className="px-2 py-1 rounded text-[9px] font-mono-share bg-pink-500/20 border border-pink-500/40 text-pink-300 hover:bg-pink-500/30 transition-colors disabled:opacity-50"
                            >
                              {creditsHook.purchasing ? "..." : "UNLOCK ALL LORAS — $30"}
                            </button>
                          </div>
                        )}
                        {comfyVideoLora !== "none" && (() => {
                          const selected = comfyModels.videoLoras.find((e) => e.name === comfyVideoLora);
                          const isPaired = selected?.high && selected?.low;
                          return (
                            <div className="mt-1.5 space-y-1.5">
                              <div>
                                <label className="font-mono-share text-[9px] text-muted-foreground/70">Strength: {comfyVideoLoraStrength.toFixed(2)}</label>
                                <input type="range" min={0} max={2} step={0.05} value={comfyVideoLoraStrength}
                                  onChange={(e) => setComfyVideoLoraStrength(Number(e.target.value))}
                                  className="w-full accent-purple-500 mt-0.5" />
                              </div>
                              {isPaired ? (
                                <div className="flex items-center gap-2 px-2 py-1 bg-purple-500/5 border border-purple-500/20 rounded">
                                  <span className="font-mono-share text-[9px] text-purple-400/70">
                                    Auto-paired: high + low noise files detected
                                  </span>
                                </div>
                              ) : (
                                <div>
                                  <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Apply to pass</label>
                                  <div className="flex gap-1.5">
                                    {(["high", "low", "both"] as const).map((p) => (
                                      <button key={p} type="button" onClick={() => setComfyVideoLoraPass(p)}
                                        className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyVideoLoraPass === p ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                                        {p === "high" ? "High Noise" : p === "low" ? "Low Noise" : "Both"}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/5 border border-purple-500/20 rounded">
                      <Film className="w-3 h-3 text-purple-400/70" />
                      <span className="font-mono-share text-[9px] text-purple-400/70">
                        Auto-generates start frame, then animates — 15 cr flat
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Engine selector — ANIMATE (image-to-video) mode */}
            {mode === "image-to-video" && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => { setAnimateEngine("comfy"); setLongLookEnabled(true); }}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${animateEngine === "comfy" ? "border-purple-500 bg-purple-500/5 shadow-[0_0_8px_rgba(168,85,247,0.15)]" : "border-border bg-card/30 hover:border-purple-500/40"}`}>
                    <div className={`font-orbitron text-[11px] ${animateEngine === "comfy" ? "text-purple-400" : "text-foreground"}`}>GLTCH PRO</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>MultiClip</span>
                      <span className={animateEngine === "comfy" ? "text-purple-400/70" : "text-muted-foreground/50"}>15 cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => { setAnimateEngine("gltch"); setLongLookEnabled(false); }}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${animateEngine === "gltch" ? "border-secondary neon-border bg-secondary/5" : "border-border bg-card/30 hover:border-secondary/40"}`}>
                    <div className={`font-orbitron text-[11px] ${animateEngine === "gltch" ? "text-secondary" : "text-foreground"}`}>GLTCH</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>WAN 2.2 I2V / T2V</span>
                      <span className={animateEngine === "gltch" ? "text-secondary/70" : "text-muted-foreground/50"}>15 cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => { setAnimateEngine("grok"); setLongLookEnabled(false); }}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${animateEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${animateEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI I2V</span>
                      <span className={animateEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>6 cr/s</span>
                    </div>
                  </button>
                </div>

                {/* GLTCH WAN settings */}
                {animateEngine === "gltch" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/5 border border-secondary/20 rounded">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                      <span className="font-mono-share text-[9px] text-secondary/70">
                        Native WAN baseline — simpler, cheaper, and more reliable
                      </span>
                    </div>
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Duration</label>
                      <div className="flex flex-wrap gap-1.5">
                        {[{ label: "~2s", value: 33 }, { label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }, { label: "~10s", value: 161 }, { label: "~15s", value: 241 }].map((p) => (
                          <button key={p.value} type="button" onClick={() => setComfyFrameCount(p.value)}
                            className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyFrameCount === p.value ? "bg-secondary/20 border-secondary/50 text-secondary border" : "bg-card/30 border border-border text-muted-foreground hover:border-secondary/30"}`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* End Frame — disabled until workers update to ComfyUI 0.7+ */}
                    
                    {comfyModels.videoLoras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Video LoRA (optional)</label>
                        <select value={comfyVideoLora} onChange={(e) => {
                          const entry = comfyModels.videoLoras.find(v => v.name === e.target.value);
                          if (entry?.nsfw && !comfyModels.xrgeHolder) return;
                          setComfyVideoLora(e.target.value);
                        }}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.videoLoras.map((entry) => (
                            <option key={entry.name} value={entry.name}
                              disabled={!!entry.nsfw && !comfyModels.xrgeHolder}
                              style={entry.nsfw && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                              {entry.nsfw && !comfyModels.xrgeHolder ? "🔒 " : ""}{entry.displayName || entry.name.replace(/_/g, " ")}{entry.high && entry.low ? " (paired)" : ""}
                            </option>
                          ))}
                        </select>
                        {!comfyModels.xrgeHolder && comfyModels.videoLoras.some(v => v.nsfw) && (
                          <div className="mt-1 font-mono-share text-[8px] text-pink-400/70 space-y-1">
                            <p>🔒 NSFW LoRAs require unlock</p>
                            <button
                              onClick={() => creditsHook.purchaseLoraUnlock()}
                              disabled={creditsHook.purchasing}
                              className="px-2 py-1 rounded text-[9px] font-mono-share bg-pink-500/20 border border-pink-500/40 text-pink-300 hover:bg-pink-500/30 transition-colors disabled:opacity-50"
                            >
                              {creditsHook.purchasing ? "..." : "UNLOCK ALL LORAS — $30"}
                            </button>
                          </div>
                        )}
                        {comfyVideoLora !== "none" && (() => {
                          const selected = comfyModels.videoLoras.find((e) => e.name === comfyVideoLora);
                          const isPaired = selected?.high && selected?.low;
                          return (
                            <div className="mt-1.5 space-y-1.5">
                              <div>
                                <label className="font-mono-share text-[9px] text-muted-foreground/70">Strength: {comfyVideoLoraStrength.toFixed(2)}</label>
                                <input type="range" min={0} max={2} step={0.05} value={comfyVideoLoraStrength}
                                  onChange={(e) => setComfyVideoLoraStrength(Number(e.target.value))}
                                  className="w-full accent-secondary mt-0.5" />
                              </div>
                              {!isPaired && (
                                <div>
                                  <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Apply to pass</label>
                                  <div className="flex gap-1.5">
                                    {(["high", "low", "both"] as const).map((p) => (
                                      <button key={p} type="button" onClick={() => setComfyVideoLoraPass(p)}
                                        className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyVideoLoraPass === p ? "bg-secondary/20 border-secondary/50 text-secondary border" : "bg-card/30 border border-border text-muted-foreground hover:border-secondary/30"}`}>
                                        {p === "high" ? "High Noise" : p === "low" ? "Low Noise" : "Both"}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}

            {/* LongLook settings (when COMFY engine selected for I2V) */}
            {mode === "image-to-video" && animateEngine === "comfy" && longLookEnabled && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/5 border border-purple-500/20 rounded">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  <span className="font-mono-share text-[9px] text-purple-400/70">
                    LongLook MultiClip — generates {longLookSeqCount} chained sequences with FreeLong spectral blending
                  </span>
                </div>
                <div>
                  <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Sequences ({longLookSeqCount})</label>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4].map((n) => (
                      <button key={n} type="button" onClick={() => setLongLookSeqCount(n)}
                        className={`px-3 py-1 rounded text-[9px] font-mono-share transition-all ${longLookSeqCount === n ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                        {n}x
                      </button>
                    ))}
                  </div>
                  <p className="mt-0.5 font-mono-share text-[8px] text-muted-foreground/50">
                    Each sequence ≈ {Math.round(longLookFrameCount / 16)}s — total ≈ {Math.round((longLookFrameCount / 16) * longLookSeqCount)}s
                  </p>
                </div>
                <div>
                  <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Frames per sequence</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[{ label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }].map((p) => (
                      <button key={p.value} type="button" onClick={() => setLongLookFrameCount(p.value)}
                        className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${longLookFrameCount === p.value ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Motion Scale: {longLookMotionScale.toFixed(1)}</label>
                  <input type="range" min={0.5} max={2.5} step={0.1} value={longLookMotionScale}
                    onChange={(e) => setLongLookMotionScale(Number(e.target.value))}
                    className="w-full accent-purple-400 mt-0.5" />
                  <p className="font-mono-share text-[8px] text-muted-foreground/50">
                    {"< 1.0 = slow motion | 1.0 = normal | > 1.0 = faster, more dynamic"}
                  </p>
                </div>
                {comfyModels.videoLoras.length > 0 && (
                  <div>
                    <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Video LoRA (optional)</label>
                    <select value={comfyVideoLora} onChange={(e) => setComfyVideoLora(e.target.value)}
                      className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                      <option value="none">None</option>
                      {comfyModels.videoLoras.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.displayName || entry.name.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    {comfyVideoLora !== "none" && (
                      <div className="mt-1.5">
                        <label className="font-mono-share text-[9px] text-muted-foreground/70">Strength: {comfyVideoLoraStrength.toFixed(2)}</label>
                        <input type="range" min={0} max={2} step={0.05} value={comfyVideoLoraStrength}
                          onChange={(e) => setComfyVideoLoraStrength(Number(e.target.value))}
                          className="w-full accent-purple-400 mt-0.5" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Seed control — shared across all GLTCH/Comfy engine modes */}
            {auth.isAuthenticated && (
              (mode === "edit-image" && editEngine === "gltch") ||
              (mode === "text-to-image" && (genEngine === "comfy" || genEngine === "gltch")) ||
              (mode === "image-to-video" && (animateEngine === "gltch" || animateEngine === "comfy"))
            ) && (
                <div className="flex items-center gap-2">
                  <label className="font-mono-share text-[9px] text-muted-foreground/70 whitespace-nowrap">SEED</label>
                  <input
                    type="text"
                    value={globalSeed}
                    onChange={(e) => setGlobalSeed(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="random"
                    className="flex-1 bg-card/60 border border-border rounded px-2 py-1 text-[10px] font-mono-share text-foreground placeholder-muted-foreground/40 max-w-[140px]"
                  />
                  {globalSeed && (
                    <button
                      type="button"
                      onClick={() => setGlobalSeed("")}
                      className="font-mono-share text-[8px] text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                      CLEAR
                    </button>
                  )}
                </div>
              )}

            {/* Negative prompt — shared across all comfy workflows */}
            {(editEngine === "gltch"
              || genEngine === "comfy" || genEngine === "gltch"
              || renderEngine === "comfy" || animateEngine === "comfy" || animateEngine === "gltch") && (
              <div className="mt-2 space-y-1">
                <label className="font-mono-share text-[9px] text-muted-foreground/60 flex items-center justify-between">
                  <span>NEGATIVE_PROMPT</span>
                  {negPrompt && (
                    <button onClick={() => setNegPrompt("")}
                      className="font-mono-share text-[8px] text-muted-foreground/50 hover:text-red-400 transition-colors">
                      CLEAR
                    </button>
                  )}
                </label>
                <input
                  type="text"
                  value={negPrompt}
                  onChange={(e) => setNegPrompt(e.target.value)}
                  placeholder="ugly, blurry, watermark... (leave empty for defaults)"
                  className="w-full bg-card/60 border border-border/50 rounded px-2.5 py-1.5 text-[10px] font-mono-share text-foreground/80 placeholder:text-muted-foreground/25 outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            )}

              </CollapsibleContent>
            </Collapsible>

            <PromptHistory history={history} onSelect={handleSelectPrompt} onRemove={removeEntry} onClear={clearHistory} />
            <PromptForm
              mode={mode}
              isLoading={isLoading}
              onSubmit={handleSubmit}
              settings={settings}
              initialPrompt={activePrompt}
              initialImageUrl={activeImageUrl}
              hideExtraImages={mode === "edit-image" && editEngine === "gltch"}
              creditCost={previewCreditCost}
              totalCredits={effectiveApiMode === "credits" ? creditsHook.totalCredits : undefined}
              videoDuration={videoSettings.duration}
              hasSubscription={creditsHook.hasSubscription}
              onOpenStore={effectiveApiMode === "credits" ? () => setStoreOpen(true) : undefined}
            />

            {/* Target folder selector */}
            {foldersHook.folders.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="font-mono-share text-[9px] text-muted-foreground/40 tracking-wider">SAVE_TO:</span>
                <select
                  value={targetFolderId || ""}
                  onChange={(e) => setTargetFolderId(e.target.value || null)}
                  className="bg-card/60 border border-border/50 rounded px-2 py-1 text-[10px] font-mono-share text-foreground/70 outline-none focus:border-primary/50 transition-colors cursor-pointer min-w-[100px]"
                >
                  <option value="">UNFILED</option>
                  {foldersHook.folders.filter(f => !f.hidden).map(f => (
                    <option key={f.id} value={f.id}>{(f.name ?? "").toUpperCase()}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>
          </>
        )}

        {/* Error display */}
        {error && (
          <div className="border border-destructive/50 rounded overflow-hidden animate-slide-up">
            <div className="flex items-center gap-2 px-4 py-1.5 bg-destructive/10 border-b border-destructive/20">
              <span className="font-mono-share text-[10px] text-destructive">stderr</span>
            </div>
            <div className="p-4">
              <p className="font-mono-share text-sm text-destructive/80">
                <span className="text-destructive/50">error: </span>{error}
              </p>
              <button
                onClick={clearError}
                className="font-mono-share text-xs text-muted-foreground hover:text-foreground mt-2 underline"
              >
                $ clear
              </button>
            </div>
          </div>
        )}

        {/* ComfyUI Job Queue */}
        {comfyJobs.length > 0 && (
          <Collapsible defaultOpen={true} asChild>
          <section className="animate-slide-up space-y-2">
            <div className="flex items-center justify-between">
              <CollapsibleTrigger className="flex items-center gap-2 group cursor-pointer">
                <span className="font-mono-share text-purple-400/40 text-[9px] group-data-[state=open]:text-purple-400/60">▸</span>
                <span className="font-orbitron text-[10px] tracking-widest text-purple-400/80">
                  COMFY_QUEUE
                </span>
                <span className="font-mono-share text-[9px] text-muted-foreground/50">
                  [{comfyJobs.filter(j => j.status === "submitting" || j.status === "generating").length} active]
                </span>
              </CollapsibleTrigger>
              {comfyJobs.some(j => j.status === "done" || j.status === "error") && (
                <button
                  onClick={clearFinishedComfyJobs}
                  className="font-mono-share text-[9px] text-muted-foreground/50 hover:text-purple-400 transition-colors"
                >
                  CLEAR FINISHED
                </button>
              )}
            </div>
            <CollapsibleContent>

            <div className="grid gap-2 sm:grid-cols-2">
              {comfyJobs.map(job => {
                const isActive = job.status === "submitting" || job.status === "generating" || job.status === "cancelling";
                const isDone = job.status === "done";
                const isError = job.status === "error";
                const mins = Math.floor(job.elapsed / 60).toString().padStart(2, "0");
                const secs = (job.elapsed % 60).toString().padStart(2, "0");

                  return (
                  <div
                    key={job.id}
                    className={`relative border rounded-lg p-3 transition-all overflow-hidden min-w-0 ${isActive
                      ? "border-purple-500/40 bg-purple-500/5 shadow-[0_0_12px_rgba(168,85,247,0.1)]"
                      : isDone
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-red-500/30 bg-red-500/5"
                      }`}
                  >
                    {/* Dismiss / Cancel button */}
                    {!isActive ? (
                      <button
                        onClick={() => dismissComfyJob(job.id)}
                        className="absolute top-2 right-2 p-0.5 rounded hover:bg-background/50 transition-colors text-muted-foreground/40 hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : job.status !== "cancelling" && (
                      <button
                        onClick={() => cancelComfyJob(job.id)}
                        className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[8px] font-orbitron tracking-wider border border-red-500/30 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      >
                        CANCEL
                      </button>
                    )}

                    {/* Mobile: CSS ring loader while generating */}
                    {isActive && (
                      <div className="sm:hidden w-20 h-20 mx-auto mb-2 relative flex items-center justify-center">
                        <svg className="absolute inset-0 w-full h-full loader-ring-spin" viewBox="0 0 80 80" fill="none">
                          <circle cx="40" cy="40" r="36" stroke="hsl(270 100% 65% / 0.15)" strokeWidth="2" />
                          <circle cx="40" cy="40" r="36" stroke="hsl(270 100% 65%)" strokeWidth="2" strokeLinecap="round" strokeDasharray="60 166" style={{ filter: "drop-shadow(0 0 4px hsl(270 100% 65% / 0.8))" }} />
                        </svg>
                        <svg className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] loader-ring-counter" viewBox="0 0 48 48" fill="none">
                          <circle cx="24" cy="24" r="20" stroke="hsl(300 100% 60% / 0.5)" strokeWidth="1" strokeLinecap="round" strokeDasharray="20 105" />
                        </svg>
                        <div className="w-2 h-2 rounded-full loader-dot-pulse" style={{ background: "hsl(var(--accent))" }} />
                      </div>
                    )}

                    {/* Status row */}
                    <div className="flex items-center gap-2 mb-1.5">
                      {isActive && (
                        <div className="relative w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                          <svg className="absolute inset-0 w-full h-full loader-ring-spin" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="6" stroke="hsl(180 100% 50% / 0.2)" strokeWidth="1.5" />
                            <circle cx="7" cy="7" r="6" stroke="hsl(180 100% 50%)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="10 28" />
                          </svg>
                        </div>
                      )}
                      {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                      {isError && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}

                      <span className={`font-orbitron text-[9px] tracking-widest uppercase ${isActive ? "text-cyan-400" : isDone ? "text-green-400" : "text-red-400"
                        }`}>
                        {job.status === "submitting" ? "SUBMITTING" : (job.status ?? "unknown").toUpperCase()}
                      </span>

                      {/* Timer */}
                      <span className={`font-mono-share text-xs tabular-nums ml-auto ${isActive ? "text-purple-300" : "text-muted-foreground/50"
                        }`}>
                        {mins}:{secs}
                      </span>
                    </div>

                    {/* Phase */}
                    {isActive && job.phase && (
                      <div className="font-mono-share text-[10px] text-purple-300/80 mb-1 animate-flicker">
                        {job.phase}
                      </div>
                    )}

                    {/* Progress bar for active jobs */}
                    {isActive && (
                      <div className="w-full h-0.5 bg-border/30 rounded-full overflow-hidden mb-1.5">
                        <div className="h-full bg-purple-500/50 rounded-full" style={{ width: "100%", animation: "pulse 1.5s ease-in-out infinite" }} />
                      </div>
                    )}

                    {/* Prompt preview */}
                    <div className="font-mono-share text-[10px] text-muted-foreground/60 truncate">
                      {job.prompt}
                    </div>

                    {/* Workflow badge + seed */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono-share text-[8px] text-purple-400/50 uppercase bg-purple-500/10 px-1.5 py-0.5 rounded">
                        {job.workflowType}
                      </span>
                      {job.seed && (
                        <span className="font-mono-share text-[8px] text-muted-foreground/40">
                          seed: {job.seed}
                        </span>
                      )}
                    </div>

                    {/* Error message */}
                    {isError && job.error && (
                      <div className="font-mono-share text-[9px] text-red-400/80 mt-1.5 line-clamp-2">
                        {job.error}
                      </div>
                    )}

                    {/* Hint text for active */}
                    {isActive && (
                      <div className="font-mono-share text-[8px] text-muted-foreground/30 mt-1">
                        {job.elapsed > 120 ? "Complex renders can take 3-5 min" : job.elapsed > 30 ? "GPU is working hard..." : "Processing..."}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </CollapsibleContent>
          </section>
          </Collapsible>
        )}

        {/* Results */}
        <Collapsible defaultOpen={true} asChild>
        <section id="results-section" className="animate-slide-up relative" style={{ animationDelay: "300ms" }}>
          {/* Post-generation walkthrough tip */}
          {showResultsTip && simpleMode && results.length > 0 && (
            <div className="mb-4 animate-slide-up">
              <div className="relative bg-card border border-primary/40 rounded-lg px-4 py-3 shadow-lg shadow-primary/10">
                {/* Step dots showing this is step 5 */}
                <div className="flex items-center gap-1.5 mb-2">
                  {[0,1,2,3,4].map(i => (
                    <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < 4 ? "bg-primary/40" : "bg-primary"}`} />
                  ))}
                  <span className="ml-auto font-mono-share text-[8px] text-muted-foreground/40">5/5</span>
                </div>
                <h4 className="font-orbitron text-xs font-bold text-primary tracking-wide mb-1">
                  🎉 5. Your result is ready!
                </h4>
                <p className="font-mono-share text-[11px] text-foreground/70 leading-relaxed mb-1">
                  Here's what you can do with it:
                </p>
                <ul className="font-mono-share text-[10px] text-foreground/60 leading-relaxed space-y-1 ml-1">
                  <li className="flex items-start gap-1.5">
                    <span className="text-primary/60 mt-px">▸</span>
                    <span><span className="text-foreground/80 font-bold">Download</span> — click the image, then hit the download icon</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-secondary/60 mt-px">▸</span>
                    <span><span className="text-foreground/80 font-bold">Edit again</span> — click "Edit" on any result to refine it further</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-accent/60 mt-px">▸</span>
                    <span><span className="text-foreground/80 font-bold">Animate</span> — turn your image into a short video clip</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-muted-foreground/60 mt-px">▸</span>
                    <span><span className="text-foreground/80 font-bold">Library</span> — all your creations are saved automatically</span>
                  </li>
                </ul>
                <div className="flex items-center justify-end mt-3">
                  <button
                    onClick={() => setShowResultsTip(false)}
                    className="font-mono-share text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                  >
                    GOT IT ✓
                  </button>
                </div>
              </div>
            </div>
          )}
          <CollapsibleTrigger className="flex items-center gap-2 mb-4 w-full group cursor-pointer">
            <span className="font-mono-share text-secondary/40 text-[9px] group-data-[state=open]:text-secondary/60">▸</span>
            <GlitchText
              text="OUTPUT_STREAM"
              className="font-orbitron text-[10px] tracking-widest text-muted-foreground"
              glitchIntensity="low"
            />
            {results.length > 0 && (
              <span className="font-mono-share text-[9px] text-muted-foreground/40">[{results.length}]</span>
            )}
            <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
            <Link
              to="/library"
              onClick={(e) => e.stopPropagation()}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded border border-primary/20 hover:border-primary/50 bg-primary/5 hover:bg-primary/10 transition-all font-mono-share text-[10px] text-primary/70 hover:text-primary tracking-wider"
            >
              <Image className="w-3 h-3" />
              FULL LIBRARY
            </Link>
          </CollapsibleTrigger>
          <CollapsibleContent>
          <Suspense fallback={<GalleryChunkLoader />}>
            <ResultsGrid
              results={results}
              isLoading={isLoading}
              elapsedSeconds={elapsedSeconds}
              loadingPhase={comfyPhase}
              onClear={clearResults}
              onDelete={deleteResult}
              onEditImage={handleEditImage}
              onAnimateImage={handleAnimateImage}
              folders={foldersHook.folders}
              selectedFilter={foldersHook.selectedFilter}
              onSelectFilter={foldersHook.selectFilter}
              onCreateFolder={foldersHook.createFolder}
              onRenameFolder={foldersHook.renameFolder}
              onDeleteFolder={foldersHook.deleteFolder}
              onToggleFolderHidden={foldersHook.toggleFolderHidden}
              onMoveToFolder={handleMoveToFolder}
              onBulkMoveToFolder={handleBulkMoveToFolder}
              onBulkDelete={handleBulkDelete}
              onEmptyTrash={handleEmptyTrash}
            />
          </Suspense>

          {/* Post-first-result upsell — shown once user has generated something */}
          {results.length > 0 && !creditsHook.hasSubscription && creditsHook.enabled && (
            <div className="mt-4 flex items-center justify-between gap-3 px-4 py-3 rounded border border-secondary/25 bg-secondary/5">
              <div className="space-y-0.5 min-w-0">
                <p className="font-orbitron text-[11px] text-secondary font-bold tracking-wider">WANT MORE?</p>
                <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-relaxed">
                  Faster renders · Priority queue · Unlimited credits from $9.99/mo
                </p>
              </div>
              <button
                onClick={() => setStoreOpen(true)}
                className="shrink-0 font-orbitron text-[10px] font-bold px-4 py-2 rounded border border-secondary/50 bg-secondary/10 text-secondary hover:bg-secondary/20 hover:border-secondary transition-all tracking-wider whitespace-nowrap"
              >
                GET CREDITS →
              </button>
            </div>
          )}
          </CollapsibleContent>
        </section>
        </Collapsible>

        {/* Footer */}
        <Collapsible defaultOpen={false}>
        <footer className="text-center py-4 border-t border-border/30 overflow-hidden">
          <CollapsibleTrigger className="flex items-center gap-2 w-full justify-center group cursor-pointer py-1">
            <span className="font-mono-share text-primary/30 text-[9px] group-data-[state=open]:text-primary/50">▸</span>
            <span className="font-mono-share text-[9px] tracking-widest text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors">
              SYSTEM_INFO v{APP_VERSION}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-2 animate-slide-up">
          <p className="font-mono-share text-[10px] text-muted-foreground/40 animate-flicker">
            <span className="text-primary/30">$</span>{" "}
            echo "POWERED BY xAI // {effectiveApiMode === "credits" ? "CREDIT-BASED" : "CLIENT-SIDE"} RENDERING"
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono-share text-[10px] px-4">
            <button
              onClick={() => setGuideOpen(true)}
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors"
            >
              <HelpCircle className="w-3 h-3" />
              GUIDE
            </button>
            <span className="text-border/50">|</span>
            <button
              onClick={() => setChangelogOpen(true)}
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-accent transition-colors"
            >
              <Zap className="w-3 h-3" />
              CHANGELOG
            </button>
            <span className="text-border/50">|</span>
            <button
              onClick={() => setTosOpen(true)}
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors"
            >
              <Shield className="w-3 h-3" />
              TERMS
            </button>
            <span className="text-border/50">|</span>
            <button
              onClick={() => setPrivacyOpen(true)}
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-secondary transition-colors"
            >
              <Eye className="w-3 h-3" />
              PRIVACY
            </button>
            <span className="text-border/50">|</span>
            <a
              href="https://discord.gg/Ge9AxRgCmM"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-accent transition-colors"
            >
              <MessageCircle className="w-3 h-3" />
              DISCORD
            </a>
            <span className="text-border/50">|</span>
            <a
              href="https://dexscreener.com/base/0xa36f942a5ee23030ac66fb0677540365c0939e662df33f729c5fa5a301eea6d2"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-green-400 transition-colors"
            >
              <span className="text-[8px] font-bold leading-none border border-current rounded-sm px-0.5">$</span>
              GROKRUN
            </a>
            <span className="text-border/50">|</span>
            <Link
              to="/library"
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-cyan-400 transition-colors"
            >
              <Image className="w-3 h-3" />
              LIBRARY
            </Link>
            {auth.isAuthenticated && (
              <>
                <span className="text-border/50">|</span>
                <Link
                  to="/characters"
                  className="flex items-center gap-1 text-muted-foreground/40 hover:text-purple-400 transition-colors"
                >
                  <Users className="w-3 h-3" />
                  CHARACTERS
                </Link>
              </>
            )}
            {effectiveApiMode === "credits" && canUseCredits && (
              <>
                <span className="text-border/50">|</span>
                <Link
                  to="/docs"
                  className="flex items-center gap-1 text-muted-foreground/40 hover:text-cyan-400 transition-colors"
                >
                  <Code className="w-3 h-3" />
                  API DOCS
                </Link>
                <span className="text-border/50">|</span>
                <ApiKeysPanel triggerClassName="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors" />
              </>
            )}
            {auth.user?.is_admin && (
              <>
                <span className="text-border/50">|</span>
                <Link
                  to="/admin"
                  className="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors"
                >
                  <Server className="w-3 h-3" />
                  ADMIN
                </Link>
              </>
            )}
          </div>
          </CollapsibleContent>
        </footer>
        </Collapsible>

        {/* Dialogs */}
        <HowToUseDialog open={guideOpen} onOpenChange={setGuideOpen} />
        <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
        <LegalDialog type="tos" open={tosOpen} onOpenChange={setTosOpen} />
        <LegalDialog type="privacy" open={privacyOpen} onOpenChange={setPrivacyOpen} />
      </div>

      {/* PWA install prompt (mobile only) */}
      <PwaInstallBanner />

      {/* Temu-style social proof */}
      <SocialProofToast />

      {/* Mobile bottom navigation */}
      <MobileBottomNav
        isAuthenticated={auth.isAuthenticated}
        onOpenStore={() => setStoreOpen(true)}
        onOpenGuide={() => setGuideOpen(true)}
        onOpenChangelog={() => setChangelogOpen(true)}
        onOpenTos={() => setTosOpen(true)}
        onOpenPrivacy={() => setPrivacyOpen(true)}
      />
    </CyberLayout>
  );
};

export default Index;
