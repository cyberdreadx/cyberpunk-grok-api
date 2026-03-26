import React, { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Image, Film, Search, X, ArrowLeft } from "lucide-react";
import CyberLayout from "@/components/CyberLayout";
import MobileBottomNav from "@/components/MobileBottomNav";
import GlitchText from "@/components/GlitchText";
import ResultsGrid from "@/components/ResultsGrid";
import HowToUseDialog from "@/components/HowToUseDialog";
import ChangelogDialog from "@/components/ChangelogDialog";
import LegalDialog from "@/components/LegalDialog";
import { useAuth } from "@/hooks/useAuth";
import { useFolders } from "@/hooks/useFolders";
import { useToast } from "@/hooks/use-toast";
import {
  loadResults,
  deleteStoredResult,
  clearStoredResults,
} from "@/lib/storage";
import { Skeleton } from "@/components/ui/skeleton";
import type { GrokResult } from "@/hooks/useGrokApi";

const Library: React.FC = () => {
  const navigate = useNavigate();
  const auth = useAuth();
  const { toast } = useToast();
  const foldersHook = useFolders();

  const [results, setResults] = useState<GrokResult[]>([]);
  const [loading, setLoading] = useState(true);
  const revokeAllRef = useRef<(() => void) | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all");

  // Dialog states
  const [guideOpen, setGuideOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [tosOpen, setTosOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { results: loaded, revokeAll } = await loadResults();
      if (!cancelled) {
        revokeAllRef.current = revokeAll;
        setResults(loaded);
        setLoading(false);
      } else {
        revokeAll();
      }
    })();
    return () => {
      cancelled = true;
      revokeAllRef.current?.();
    };
  }, []);

  const deleteResult = useCallback(async (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
    try { await deleteStoredResult(id); } catch (e) { console.error("[library] delete failed:", e); }
  }, []);

  const clearResults = useCallback(async () => {
    setResults([]);
    revokeAllRef.current?.();
    revokeAllRef.current = null;
    try { await clearStoredResults(); } catch (e) { console.error("[library] clear failed:", e); }
  }, []);

  const updateResultFolder = useCallback((resultId: string, folderId: string | null) => {
    setResults(prev => prev.map(r => r.id === resultId ? { ...r, folderId } : r));
  }, []);

  const handleMoveToFolder = useCallback(async (resultId: string, folderId: string | null) => {
    try {
      await foldersHook.moveToFolder(resultId, folderId);
      updateResultFolder(resultId, folderId);
    } catch {
      toast({ title: "FOLDER ERROR", description: "Failed to move item.", variant: "destructive" });
    }
  }, [foldersHook, updateResultFolder, toast]);

  const handleBulkMoveToFolder = useCallback(async (ids: string[], folderId: string | null) => {
    try {
      await foldersHook.bulkMoveToFolder(ids, folderId);
      for (const id of ids) updateResultFolder(id, folderId);
    } catch {
      toast({ title: "FOLDER ERROR", description: "Failed to move items.", variant: "destructive" });
    }
  }, [foldersHook, updateResultFolder, toast]);

  const handleBulkDelete = useCallback(async (ids: string[]) => {
    try {
      await foldersHook.bulkDelete(ids);
      for (const id of ids) deleteResult(id);
    } catch {
      toast({ title: "DELETE ERROR", description: "Failed to delete items.", variant: "destructive" });
    }
  }, [foldersHook, deleteResult, toast]);

  const handleEmptyTrash = useCallback(async () => {
    try {
      const deletedIds = await foldersHook.emptyTrashFolder();
      for (const id of deletedIds) deleteResult(id);
    } catch {
      toast({ title: "TRASH ERROR", description: "Failed to empty trash.", variant: "destructive" });
    }
  }, [foldersHook, deleteResult, toast]);

  const handleEditImage = useCallback((imageUrl: string) => {
    sessionStorage.setItem("library-edit-image", imageUrl);
    navigate("/?action=edit");
  }, [navigate]);

  const handleAnimateImage = useCallback((imageUrl: string) => {
    sessionStorage.setItem("library-animate-image", imageUrl);
    navigate("/?action=animate");
  }, [navigate]);

  // Filter results by search query and type
  const displayResults = React.useMemo(() => {
    let filtered = results;
    if (typeFilter !== "all") {
      filtered = filtered.filter(r => r.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(r => r.revised_prompt?.toLowerCase().includes(q));
    }
    return filtered;
  }, [results, typeFilter, searchQuery]);

  // Stats
  const totalImages = results.filter(r => r.type === "image" && r.folderId !== "__trash").length;
  const totalVideos = results.filter(r => r.type === "video" && r.folderId !== "__trash").length;
  const totalFolders = foldersHook.folders.length;

  return (
    <CyberLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 sm:pb-8 space-y-6" style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}>
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate("/")}
                className="p-1.5 rounded border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-muted-foreground/60 hover:text-primary"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <GlitchText
                  text="MEDIA_LIBRARY"
                  className="font-orbitron text-lg sm:text-xl tracking-widest text-primary"
                  glitchIntensity="low"
                />
                <p className="font-mono-share text-[10px] text-muted-foreground/50 mt-0.5">
                  <span className="text-primary/30">$</span> ls -la ~/output/ — {totalImages + totalVideos} assets indexed
                </p>
              </div>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border/40 bg-card/40">
              <Image className="w-3.5 h-3.5 text-primary/60" />
              <span className="font-mono-share text-[11px] text-foreground/70">{totalImages}</span>
              <span className="font-mono-share text-[9px] text-muted-foreground/40">IMAGES</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border/40 bg-card/40">
              <Film className="w-3.5 h-3.5 text-secondary/60" />
              <span className="font-mono-share text-[11px] text-foreground/70">{totalVideos}</span>
              <span className="font-mono-share text-[9px] text-muted-foreground/40">VIDEOS</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border/40 bg-card/40">
              <span className="font-mono-share text-[11px] text-foreground/70">{totalFolders}</span>
              <span className="font-mono-share text-[9px] text-muted-foreground/40">FOLDERS</span>
            </div>
          </div>

        </div>

        {/* Loading state */}
        {loading ? (
          <div className="space-y-4">
            {/* Folder bar skeleton */}
            <div className="flex items-center gap-2 overflow-hidden">
              {[80, 96, 72, 88, 64].map((w, i) => (
                <Skeleton
                  key={i}
                  className="h-7 rounded border border-border/30 bg-muted/30 flex-shrink-0"
                  style={{ width: w }}
                />
              ))}
            </div>
            {/* Grid skeleton */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton
                    className="w-full rounded border border-border/20 bg-muted/20"
                    style={{ aspectRatio: "1 / 1" }}
                  />
                  <Skeleton className="h-2.5 w-3/4 bg-muted/20 rounded" />
                  <Skeleton className="h-2 w-1/2 bg-muted/15 rounded" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ResultsGrid
            results={displayResults}
            isLoading={false}
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
        )}
      </div>

      {/* Mobile bottom navigation */}
      <MobileBottomNav
        isAuthenticated={auth.isAuthenticated}
        onOpenGuide={() => setGuideOpen(true)}
        onOpenChangelog={() => setChangelogOpen(true)}
        onOpenTos={() => setTosOpen(true)}
        onOpenPrivacy={() => setPrivacyOpen(true)}
      />

      {/* Dialogs */}
      <HowToUseDialog open={guideOpen} onOpenChange={setGuideOpen} />
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
      <LegalDialog type="tos" open={tosOpen} onOpenChange={setTosOpen} />
      <LegalDialog type="privacy" open={privacyOpen} onOpenChange={setPrivacyOpen} />
    </CyberLayout>
  );
};

export default Library;
