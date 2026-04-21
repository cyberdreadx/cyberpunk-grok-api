/**
 * LibraryPicker — modal that lets the user pick a previously generated
 * image/video from their on-device IndexedDB library and use it as the
 * media for a new feed post or story.
 *
 * Shows folder tabs along the top so users can quickly narrow down to a
 * specific folder (or "All" / "Unfiled" / "Trash"). Each thumbnail is
 * tap-to-select; the selected item is returned to the parent which
 * handles the actual post submission.
 */

import React, { useEffect, useMemo, useState } from "react";
import { X, FolderOpen, Loader2, ImageIcon, Film, Inbox, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadResults, loadFolders, TRASH_FOLDER_ID, type Folder } from "@/lib/storage";
import type { GrokResult } from "@/hooks/useGrokApi";

interface LibraryPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (result: GrokResult) => void;
  /** Optional restriction: e.g. "image" only when posting to a media-only target. */
  mediaType?: "image" | "video" | "all";
  busy?: boolean;
}

type FolderFilter = "all" | "unfiled" | string;

const LibraryPicker: React.FC<LibraryPickerProps> = ({
  open,
  onClose,
  onSelect,
  mediaType = "all",
  busy = false,
}) => {
  const [results, setResults] = useState<GrokResult[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FolderFilter>("all");
  const [query, setQuery] = useState("");
  const [revoke, setRevoke] = useState<(() => void) | null>(null);

  // Load on open; clean up object URLs on close/unmount.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [{ results: loaded, revokeAll }, fs] = await Promise.all([
          loadResults(),
          loadFolders(),
        ]);
        if (cancelled) {
          revokeAll();
          return;
        }
        setResults(loaded);
        setFolders(fs);
        setRevoke(() => revokeAll);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      revoke?.();
    };
  }, [revoke]);

  const visibleFolders = useMemo(
    () => folders.filter((f) => !f.hidden && f.id !== TRASH_FOLDER_ID),
    [folders],
  );

  const filteredResults = useMemo(() => {
    let list = results;
    if (mediaType !== "all") list = list.filter((r) => r.type === mediaType);
    if (filter === "unfiled") {
      list = list.filter((r) => !r.folderId || r.folderId === TRASH_FOLDER_ID === false && !r.folderId);
      list = results.filter((r) => (mediaType === "all" || r.type === mediaType) && !r.folderId);
    } else if (filter !== "all") {
      list = list.filter((r) => r.folderId === filter);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((r) => (r.revised_prompt || "").toLowerCase().includes(q));
    }
    return list;
  }, [results, filter, query, mediaType]);

  if (!open) return null;

  const folderTab = (id: FolderFilter, label: string, icon?: React.ReactNode) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className={`flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-full font-mono-share text-[10px] tracking-wider border transition-colors ${
        filter === id
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl bg-card border border-border/40 shadow-2xl flex flex-col max-h-[85dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-primary" />
            <span className="font-orbitron text-xs tracking-widest">PICK FROM LIBRARY</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Close library picker"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Folder tabs */}
        <div className="px-3 pt-3 flex gap-1.5 overflow-x-auto scrollbar-hide pb-2 border-b border-border/20">
          {folderTab("all", "ALL", <ImageIcon className="w-3 h-3" />)}
          {folderTab("unfiled", "UNFILED", <Inbox className="w-3 h-3" />)}
          {visibleFolders.map((f) => folderTab(f.id, f.name.toUpperCase()))}
        </div>

        {/* Search */}
        <div className="px-3 pt-2 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts…"
              className="pl-7 h-8 text-xs font-mono-share bg-input/40"
            />
          </div>
        </div>

        {/* Results grid */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="text-center py-16 px-4">
              <p className="font-mono-share text-xs text-muted-foreground">
                {results.length === 0
                  ? "Your library is empty. Generate something first."
                  : "Nothing in this folder matches."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {filteredResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(r)}
                  className="group relative aspect-square rounded-md overflow-hidden border border-border/30 bg-muted/20 hover:border-primary/60 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                  title={r.revised_prompt || ""}
                >
                  {r.type === "video" ? (
                    <video
                      src={r.url}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={r.url}
                      alt={r.revised_prompt || "Library item"}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="absolute top-1 right-1 bg-black/60 backdrop-blur-sm rounded px-1 py-0.5 flex items-center gap-0.5">
                    {r.type === "video" ? (
                      <Film className="w-2.5 h-2.5 text-white" />
                    ) : (
                      <ImageIcon className="w-2.5 h-2.5 text-white" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {busy && (
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="flex items-center gap-2 text-primary font-mono-share text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> UPLOADING…
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LibraryPicker;
