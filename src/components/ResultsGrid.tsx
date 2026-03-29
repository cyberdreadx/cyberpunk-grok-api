import React, { useState, useCallback, useRef, useEffect } from "react";
import { Download, Maximize2, X, Trash2, ExternalLink, ChevronLeft, ChevronRight, Pencil, Film, Copy, Check, FolderPlus, FolderOpen, MoreVertical, FolderInput, Lock, LockOpen, ShieldCheck, Eye, EyeOff, ChevronDown, Sparkles, Archive, Loader2, Link2, CheckSquare, Square, ListChecks, RotateCcw, XCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { GrokResult } from "@/hooks/useGrokApi";
import type { Folder } from "@/lib/storage";
import { exportLibraryAsZip, getResultDataUrl } from "@/lib/storage";
import type { FolderFilter } from "@/hooks/useFolders";
import { useSwipe } from "@/hooks/useSwipe";
import ShareCTA from "@/components/ShareCTA";

// ── PIN Utilities ────────────────────────────────────────────────────────

const PIN_STORAGE_KEY = "folder-pins";

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadPinHashes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePinHashes(pins: Record<string, string>) {
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pins));
}

function folderHasPin(folderId: string): boolean {
  return !!loadPinHashes()[folderId];
}

async function verifyPin(folderId: string, pin: string): Promise<boolean> {
  const hashes = loadPinHashes();
  const stored = hashes[folderId];
  if (!stored) return true;
  const attempt = await hashPin(pin);
  return attempt === stored;
}

async function setFolderPin(folderId: string, pin: string): Promise<void> {
  const hashes = loadPinHashes();
  hashes[folderId] = await hashPin(pin);
  savePinHashes(hashes);
}

function removeFolderPin(folderId: string): void {
  const hashes = loadPinHashes();
  delete hashes[folderId];
  savePinHashes(hashes);
}

// ── PIN Dialog Component ─────────────────────────────────────────────────

function PinDialog({
  mode,
  folderName,
  onSubmit,
  onCancel,
}: {
  mode: "set" | "unlock" | "remove";
  folderName: string;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const inputRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  useEffect(() => {
    inputRefs[0].current?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);
    setError("");
    if (value && index < 3) {
      inputRefs[index + 1].current?.focus();
    }
    // Auto-submit when all 4 digits entered
    if (value && index === 3 && newDigits.every((d) => d !== "")) {
      onSubmit(newDigits.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs[index - 1].current?.focus();
    }
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && digits.every((d) => d !== "")) {
      onSubmit(digits.join(""));
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length === 4) {
      const newDigits = pasted.split("");
      setDigits(newDigits);
      onSubmit(newDigits.join(""));
    }
  };

  const title =
    mode === "set" ? "SET_SECURITY_PIN" :
      mode === "remove" ? "REMOVE_SECURITY_PIN" :
        "ENTER_ACCESS_CODE";

  const subtitle =
    mode === "set" ? `Arm folder "${folderName}" with a 4-digit lock` :
      mode === "remove" ? `Enter current PIN to disarm "${folderName}"` :
        `Folder "${folderName}" is locked — enter PIN to decrypt`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-card border border-primary/40 rounded-lg p-6 w-80 shadow-lg shadow-primary/10 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            {mode === "unlock" ? (
              <Lock className="w-5 h-5 text-secondary" />
            ) : mode === "remove" ? (
              <LockOpen className="w-5 h-5 text-destructive" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-primary" />
            )}
            <h3 className="font-orbitron text-sm tracking-wider text-primary">
              {title}
            </h3>
          </div>
          <p className="font-mono-share text-[10px] text-muted-foreground/60">
            {subtitle}
          </p>

          <div className="flex justify-center gap-3 py-3" onPaste={handlePaste}>
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={inputRefs[i]}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                aria-label={`PIN digit ${i + 1}`}
                className="w-12 h-14 text-center text-xl font-orbitron bg-background border-2 border-primary/30 rounded-md text-primary outline-none focus:border-primary focus:shadow-[0_0_10px_hsl(var(--neon-cyan)/0.3)] transition-all"
              />
            ))}
          </div>

          {error && (
            <p className="font-mono-share text-[10px] text-destructive animate-flicker">
              {error}
            </p>
          )}

          <div className="flex justify-center gap-2 pt-1">
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-[10px] font-mono-share text-muted-foreground/60 hover:text-muted-foreground border border-border/50 rounded transition-colors"
            >
              ABORT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ResultsGridProps {
  results: GrokResult[];
  isLoading: boolean;
  elapsedSeconds?: number;
  loadingPhase?: string | null;
  onClear: () => void;
  onDelete: (id: string) => void;
  onEditImage?: (imageUrl: string) => void;
  onAnimateImage?: (imageUrl: string) => void;
  // Folder props
  folders?: Folder[];
  selectedFilter?: FolderFilter;
  onSelectFilter?: (filter: FolderFilter) => void;
  onCreateFolder?: (name: string) => Promise<any>;
  onRenameFolder?: (id: string, name: string) => Promise<void>;
  onDeleteFolder?: (id: string) => Promise<void>;
  onToggleFolderHidden?: (id: string) => Promise<void>;
  onMoveToFolder?: (resultId: string, folderId: string | null) => Promise<any>;
  // Bulk / Trash props
  onBulkMoveToFolder?: (ids: string[], folderId: string | null) => Promise<void>;
  onBulkDelete?: (ids: string[]) => Promise<void>;
  onEmptyTrash?: () => Promise<void>;
  // Search / filter props (rendered sticky inside the grid)
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  typeFilter?: "all" | "image" | "video";
  onTypeFilterChange?: (t: "all" | "image" | "video") => void;
}

const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

/** True if the URL is a local data: or blob: URL that can be fetched without CORS. */
const isLocalUrl = (url: string) => url.startsWith("data:") || url.startsWith("blob:");

/** Safely fetch a URL as a Blob; returns null on CORS / network errors. */
async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/**
 * For external URLs (like vidgen.x.ai) that block CORS, route through
 * our server-side proxy which fetches and returns the file with proper headers.
 * Uses the Vercel `/api/download` route (or `VITE_API_URL` when split-hosted).
 */
function getProxyDownloadUrl(url: string, filename: string): string {
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";
  const base = `${apiBase}/download`;
  return `${base}?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
}

/**
 * Download / save media.
 */
async function downloadMedia(url: string, type: "image" | "video"): Promise<boolean> {
  const ext = type === "image" ? "png" : "mp4";
  const mime = type === "image" ? "image/png" : "video/mp4";
  const filename = `grok-${type}-${Date.now()}.${ext}`;

  if (isLocalUrl(url)) {
    const blob = await fetchBlob(url);
    if (blob && blob.size > 0) {
      if (navigator.share && isMobile()) {
        try {
          const file = new File([blob], filename, { type: blob.type || mime });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file] });
            return false;
          }
        } catch (err: any) {
          if (err?.name === "AbortError") return false;
        }
      }
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
      return false;
    }
  }

  const proxyUrl = getProxyDownloadUrl(url, filename);

  if (navigator.share && isMobile()) {
    try {
      const proxyBlob = await fetchBlob(proxyUrl);
      if (proxyBlob && proxyBlob.size > 0) {
        const file = new File([proxyBlob], filename, { type: proxyBlob.type || mime });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
          return false;
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return false;
    }

    if (isIOS()) {
      try {
        await navigator.share({ url: proxyUrl, title: filename });
        return false;
      } catch (err: any) {
        if (err?.name === "AbortError") return false;
      }
    }
  }

  const a = document.createElement("a");
  a.href = proxyUrl;
  a.download = filename;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return false;
}

// ── Folder Bar Component ────────────────────────────────────────────────

function FolderBar({
  folders,
  selectedFilter,
  onSelectFilter,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolderHidden,
  resultCounts,
  unlockedFolders,
  onRequestUnlock,
  onSetPin,
  onRemovePin,
  onLockFolder,
}: {
  folders: Folder[];
  selectedFilter: FolderFilter;
  onSelectFilter: (filter: FolderFilter) => void;
  onCreateFolder: (name: string) => Promise<any>;
  onRenameFolder?: (id: string, name: string) => Promise<void>;
  onDeleteFolder?: (id: string) => Promise<void>;
  onToggleFolderHidden?: (id: string) => Promise<void>;
  resultCounts: Record<string, number>;
  unlockedFolders: Set<string>;
  onRequestUnlock: (folderId: string) => void;
  onSetPin: (folderId: string) => void;
  onRemovePin: (folderId: string) => void;
  onLockFolder: (folderId: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; count: number } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const visibleFolders = folders.filter((f) => !f.hidden);
  const hiddenFolders = folders.filter((f) => f.hidden);

  useEffect(() => { if (isCreating) createInputRef.current?.focus(); }, [isCreating]);
  useEffect(() => { if (editingId) editInputRef.current?.focus(); }, [editingId]);

  const handleCreate = async () => {
    const name = newFolderName.trim();
    if (!name) { setIsCreating(false); return; }
    try { await onCreateFolder(name); setNewFolderName(""); setIsCreating(false); }
    catch (err: any) { console.error("[FolderBar] Create failed:", err.message); }
  };

  const handleRename = async (id: string) => {
    const name = editingName.trim();
    if (!name || !onRenameFolder) { setEditingId(null); return; }
    try { await onRenameFolder(id, name); } catch (err: any) { console.error("[FolderBar] Rename failed:", err.message); }
    setEditingId(null);
  };

  const currentFilterName = () => {
    if (selectedFilter === "unfiled") return "UNFILED";
    if (selectedFilter === "all") return "ALL";
    if (selectedFilter === "__trash") return "TRASH";
    if (selectedFilter === "none") return "LOCKED";
    return folders.find((f) => f.id === selectedFilter)?.name?.toUpperCase() || "ALL";
  };

  const currentCount = () => {
    if (selectedFilter === "unfiled") return resultCounts["__unfiled"] ?? 0;
    if (selectedFilter === "all") return resultCounts["__total"] ?? 0;
    if (selectedFilter === "__trash") return resultCounts["__trash"] ?? 0;
    if (selectedFilter === "none") return 0;
    return resultCounts[selectedFilter] ?? 0;
  };

  // Mobile folder row
  const renderMobileRow = (id: string, label: string, countKey: string, isBuiltIn: boolean, folder?: Folder) => {
    const pinId = isBuiltIn ? `__${id}` : id;
    const filterValue = id;
    const hasPin = folderHasPin(pinId);
    const isUnlocked = unlockedFolders.has(pinId);
    const isLocked = hasPin && !isUnlocked;
    const isActive = selectedFilter === filterValue;
    const count = resultCounts[countKey] ?? 0;

    return (
      <div key={pinId} className={`flex items-center justify-between px-3 py-2.5 rounded transition-all ${isActive ? "bg-primary/10 border border-primary/30" : "border border-transparent hover:bg-muted/30"}`}>
        <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => {
          if (isLocked) { onRequestUnlock(pinId); }
          else { onSelectFilter(filterValue); setMobileOpen(false); }
        }}>
          {hasPin ? (isLocked ? <Lock className="w-3.5 h-3.5 flex-shrink-0 text-secondary" /> : <LockOpen className="w-3.5 h-3.5 flex-shrink-0 text-primary/50" />) : !isBuiltIn ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/60" /> : null}

          {editingId === id ? (
            <input ref={editInputRef} value={editingName} onChange={(e) => setEditingName(e.target.value)} onBlur={() => handleRename(id)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(id); if (e.key === "Escape") setEditingId(null); }}
              onClick={(e) => e.stopPropagation()} className="bg-input border border-primary/50 rounded px-1.5 py-0.5 text-[11px] font-mono-share w-28 outline-none text-primary" />
          ) : (
            <span className={`font-mono-share text-[11px] tracking-wider truncate ${isActive ? "text-primary font-semibold" : isLocked ? "text-muted-foreground/50" : "text-foreground/80"}`}>{label}</span>
          )}
          <span className={`font-mono-share text-[10px] flex-shrink-0 ${isActive ? "text-primary/60" : "text-muted-foreground/40"}`}>{isLocked ? "•••" : count}</span>
        </button>

        <div className="flex items-center gap-0.5 ml-1">
          {!isBuiltIn && !isLocked && (
            <button className="p-1.5 text-muted-foreground/40 hover:text-primary transition-colors" onClick={(e) => { e.stopPropagation(); setEditingId(id); setEditingName(folder?.name || ""); }} title="Rename">
              <Pencil className="w-3 h-3" />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors"><MoreVertical className="w-3 h-3" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px] bg-card border-border">
              {hasPin ? (
                <DropdownMenuItem className="text-[11px] min-h-[40px] py-2 font-mono-share text-secondary focus:bg-secondary/10 cursor-pointer" onSelect={() => onRemovePin(pinId)}>
                  <LockOpen className="w-3 h-3 mr-1.5" /> REMOVE PIN
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="text-[11px] min-h-[40px] py-2 font-mono-share text-primary focus:bg-primary/10 cursor-pointer" onSelect={() => onSetPin(pinId)}>
                  <Lock className="w-3 h-3 mr-1.5" /> SET PIN
                </DropdownMenuItem>
              )}
              {!isBuiltIn && onToggleFolderHidden && (
                <DropdownMenuItem className="text-[11px] min-h-[40px] py-2 font-mono-share text-muted-foreground focus:bg-muted/50 cursor-pointer" onSelect={() => onToggleFolderHidden(id)}>
                  <ShieldCheck className="w-3 h-3 mr-1.5" /> VAULT
                </DropdownMenuItem>
              )}
              {!isBuiltIn && onDeleteFolder && (
                <DropdownMenuItem className="text-[11px] min-h-[40px] py-2 font-mono-share text-destructive focus:bg-destructive/10 cursor-pointer"
                  onSelect={() => setDeleteConfirm({ id, name: folder?.name || label, count: resultCounts[id] ?? 0 })}>
                  <Trash2 className="w-3 h-3 mr-1.5" /> DELETE
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  const tabClass = (active: boolean) =>
    `px-2.5 py-1.5 text-[10px] font-mono-share tracking-wider whitespace-nowrap transition-colors rounded-t border-b-2 flex items-center ${active
      ? "border-primary text-primary bg-primary/10"
      : "border-transparent text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30"
    }`;

  // Desktop: built-in tab (UNFILED / ALL)
  const renderDesktopBuiltIn = (id: string, label: string, countKey: string) => {
    const pinId = `__${id}`;
    const hasPin = folderHasPin(pinId);
    const isUnlocked = unlockedFolders.has(pinId);
    const isLocked = hasPin && !isUnlocked;
    return (
      <div key={pinId} className="flex items-center">
        <button className={tabClass(selectedFilter === id)} onClick={() => { if (isLocked) onRequestUnlock(pinId); else onSelectFilter(id); }}>
          {hasPin && (isLocked ? <Lock className="w-3 h-3 inline-block mr-1 -mt-0.5 text-secondary" /> : <LockOpen className="w-3 h-3 inline-block mr-1 -mt-0.5 text-primary/50" />)}
          {label}
          <span className="ml-1 text-muted-foreground/40">{isLocked ? "***" : (resultCounts[countKey] ?? 0)}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="p-0.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors"><MoreVertical className="w-3 h-3" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px] bg-card border-border">
            {hasPin ? (<>
              {isUnlocked && <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share cursor-pointer" onSelect={() => onLockFolder(pinId)}><Lock className="w-3 h-3 mr-1.5" /> LOCK</DropdownMenuItem>}
              <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share text-secondary cursor-pointer" onSelect={() => onRemovePin(pinId)}><LockOpen className="w-3 h-3 mr-1.5" /> REMOVE PIN</DropdownMenuItem>
            </>) : (
              <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share text-primary cursor-pointer" onSelect={() => onSetPin(pinId)}><Lock className="w-3 h-3 mr-1.5" /> SET PIN</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <>
      {/* ── Mobile: Collapsible dropdown ── */}
      <div className="sm:hidden">
        <button onClick={() => setMobileOpen(!mobileOpen)}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded border transition-all ${mobileOpen ? "border-primary/40 bg-primary/5" : "border-border/50 bg-card/60 hover:border-primary/30"}`}>
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-primary/60" />
            <span className="font-orbitron text-[11px] tracking-wider text-primary">{currentFilterName()}</span>
            <span className="font-mono-share text-[10px] text-muted-foreground/50 bg-muted/30 px-1.5 py-0.5 rounded">{currentCount()}</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground/50 transition-transform ${mobileOpen ? "rotate-180" : ""}`} />
        </button>

        {mobileOpen && (
          <div className="mt-1 border border-border/50 rounded bg-card/80 backdrop-blur-sm py-1 space-y-0.5 animate-slide-up max-h-[50vh] overflow-y-auto">
            {renderMobileRow("unfiled", "UNFILED", "__unfiled", true)}
            {visibleFolders.map((f) => renderMobileRow(f.id, (f.name ?? "").toUpperCase(), f.id, false, f))}
            {renderMobileRow("all", "ALL", "__total", true)}
            {/* Trash tab (mobile) */}
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${selectedFilter === "__trash" ? "bg-destructive/10 text-destructive" : "hover:bg-muted/30 text-muted-foreground/60"}`}
              onClick={() => { onSelectFilter?.("__trash"); setMobileOpen(false); }}
            >
              <Trash2 className="w-3 h-3" />
              <span className="font-mono-share text-[10px]">TRASH</span>
              <span className="font-mono-share text-[10px] text-muted-foreground/40 ml-auto">{resultCounts.__trash ?? 0}</span>
            </button>

            {hiddenFolders.length > 0 && (() => {
              const vaultHasPin = folderHasPin("__vault");
              const vaultUnlocked = unlockedFolders.has("__vault");
              const vaultLocked = vaultHasPin && !vaultUnlocked;
              return (
                <div className="border-t border-border/30 pt-1 mt-1">
                  <div className="px-3 py-1 text-[8px] font-orbitron tracking-wider text-muted-foreground/40 flex items-center gap-1.5">
                    VAULT
                    {vaultHasPin && (vaultLocked
                      ? <Lock className="w-2.5 h-2.5 text-secondary" />
                      : <LockOpen className="w-2.5 h-2.5 text-muted-foreground/30" />
                    )}
                  </div>
                  {vaultLocked ? (
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors" onClick={() => { onRequestUnlock("__vault"); setMobileOpen(false); }}>
                      <Lock className="w-3 h-3 text-secondary" />
                      <span className="font-mono-share text-[10px] text-secondary">TAP TO UNLOCK</span>
                    </button>
                  ) : (<>
                    {hiddenFolders.map((f) => (
                      <button key={f.id} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors" onClick={() => onToggleFolderHidden?.(f.id)}>
                        <Eye className="w-3 h-3 text-muted-foreground/40" />
                        <span className="font-mono-share text-[10px] text-muted-foreground/60">{(f.name ?? "").toUpperCase()}</span>
                        <span className="font-mono-share text-[8px] text-muted-foreground/30 ml-auto">RESTORE</span>
                      </button>
                    ))}
                    {vaultHasPin ? (
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors" onClick={() => { onLockFolder("__vault"); setMobileOpen(false); }}>
                        <Lock className="w-3 h-3 text-muted-foreground/40" />
                        <span className="font-mono-share text-[10px] text-muted-foreground/40">LOCK VAULT</span>
                      </button>
                    ) : (
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors" onClick={() => { onSetPin("__vault"); setMobileOpen(false); }}>
                        <Lock className="w-3 h-3 text-muted-foreground/40" />
                        <span className="font-mono-share text-[10px] text-muted-foreground/40">SET PIN</span>
                      </button>
                    )}
                  </>)}
                </div>
              );
            })()}

            <div className="border-t border-border/30 pt-1 mt-1 px-2">
              {isCreating ? (
                <input ref={createInputRef} value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onBlur={handleCreate}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setIsCreating(false); setNewFolderName(""); } }}
                  placeholder="folder name..." className="w-full bg-input border border-primary/50 rounded px-2 py-1.5 text-[11px] font-mono-share outline-none text-primary placeholder:text-muted-foreground/30" />
              ) : (
                <button className="w-full flex items-center gap-2 px-1 py-2 text-muted-foreground/50 hover:text-primary transition-colors" onClick={() => setIsCreating(true)}>
                  <FolderPlus className="w-3.5 h-3.5" /><span className="font-mono-share text-[10px]">NEW FOLDER</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop: Horizontal tab bar ── */}
      <div className="hidden sm:flex items-center gap-0.5 overflow-x-auto scrollbar-hide pb-px border-b border-border/50 -mb-px">
        {renderDesktopBuiltIn("unfiled", "UNFILED", "__unfiled")}
        {visibleFolders.map((folder) => {
          const hasPin = folderHasPin(folder.id);
          const isUnlocked = unlockedFolders.has(folder.id);
          const isLocked = hasPin && !isUnlocked;
          return (
            <div key={folder.id} className="flex items-center">
              {editingId === folder.id ? (
                <input ref={editInputRef} value={editingName} onChange={(e) => setEditingName(e.target.value)} onBlur={() => handleRename(folder.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(folder.id); if (e.key === "Escape") setEditingId(null); }}
                  className="bg-input border border-primary/50 rounded px-1.5 py-1 text-[10px] font-mono-share w-20 outline-none text-primary" />
              ) : (
                <button className={tabClass(selectedFilter === folder.id)} onClick={() => { if (isLocked) onRequestUnlock(folder.id); else onSelectFilter(folder.id); }}
                  onDoubleClick={() => { if (!isLocked) { setEditingId(folder.id); setEditingName(folder.name); } }}>
                  {hasPin ? (isLocked ? <Lock className="w-3 h-3 inline-block mr-1 -mt-0.5 text-secondary" /> : <LockOpen className="w-3 h-3 inline-block mr-1 -mt-0.5 text-primary/50" />) : <FolderOpen className="w-3 h-3 inline-block mr-1 -mt-0.5" />}
                  {(folder.name ?? "").toUpperCase()}
                  <span className="ml-1 text-muted-foreground/40">{isLocked ? "***" : (resultCounts[folder.id] ?? 0)}</span>
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="p-0.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors"><MoreVertical className="w-3 h-3" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[120px] bg-card border-border">
                  <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share cursor-pointer" onSelect={() => { setEditingId(folder.id); setEditingName(folder.name); }}><Pencil className="w-3 h-3 mr-1.5" /> RENAME</DropdownMenuItem>
                  {hasPin ? (<>
                    {isUnlocked && <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share cursor-pointer" onSelect={() => onLockFolder(folder.id)}><Lock className="w-3 h-3 mr-1.5" /> LOCK</DropdownMenuItem>}
                    <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share text-secondary cursor-pointer" onSelect={() => onRemovePin(folder.id)}><LockOpen className="w-3 h-3 mr-1.5" /> REMOVE PIN</DropdownMenuItem>
                  </>) : (
                    <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share text-primary cursor-pointer" onSelect={() => onSetPin(folder.id)}><Lock className="w-3 h-3 mr-1.5" /> SET PIN</DropdownMenuItem>
                  )}
                  {onToggleFolderHidden && <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share text-muted-foreground cursor-pointer" onSelect={() => onToggleFolderHidden(folder.id)}><ShieldCheck className="w-3 h-3 mr-1.5" /> VAULT</DropdownMenuItem>}
                  {onDeleteFolder && <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share text-destructive cursor-pointer" onSelect={() => setDeleteConfirm({ id: folder.id, name: folder.name, count: resultCounts[folder.id] ?? 0 })}><Trash2 className="w-3 h-3 mr-1.5" /> DELETE</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        {hiddenFolders.length > 0 && (() => {
          const vaultHasPin = folderHasPin("__vault");
          const vaultUnlocked = unlockedFolders.has("__vault");
          const vaultLocked = vaultHasPin && !vaultUnlocked;
          return vaultLocked ? (
            <button
              className="px-2 py-1.5 flex items-center gap-1 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
              title="Vault (locked)"
              onClick={() => onRequestUnlock("__vault")}
            >
              <Lock className="w-3 h-3" /><span className="text-[8px] font-mono-share opacity-50">{hiddenFolders.length}</span>
            </button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button className="px-2 py-1.5 flex items-center gap-1 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors" title="Vault"><ShieldCheck className="w-3 h-3" /><span className="text-[8px] font-mono-share opacity-50">{hiddenFolders.length}</span></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[140px] bg-card border-border">
                <div className="px-3 py-1.5 text-[9px] font-orbitron tracking-wider text-muted-foreground/40 border-b border-border/50 mb-1">VAULT</div>
                {hiddenFolders.map((f) => <DropdownMenuItem key={f.id} className="text-[10px] py-1.5 font-mono-share text-muted-foreground cursor-pointer" onSelect={() => onToggleFolderHidden?.(f.id)}><Eye className="w-3 h-3 mr-1.5" /> {(f.name ?? "").toUpperCase()} — RESTORE</DropdownMenuItem>)}
                <div className="border-t border-border/50 mt-1 pt-1">
                  {vaultHasPin ? (<>
                    <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share cursor-pointer" onSelect={() => onLockFolder("__vault")}><Lock className="w-3 h-3 mr-1.5" /> LOCK VAULT</DropdownMenuItem>
                    <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share text-secondary cursor-pointer" onSelect={() => onRemovePin("__vault")}><LockOpen className="w-3 h-3 mr-1.5" /> REMOVE PIN</DropdownMenuItem>
                  </>) : (
                    <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share text-primary cursor-pointer" onSelect={() => onSetPin("__vault")}><Lock className="w-3 h-3 mr-1.5" /> SET PIN</DropdownMenuItem>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })()}
        {renderDesktopBuiltIn("all", "ALL", "__total")}
        {/* Trash tab */}
        <button
          className={`${tabClass(selectedFilter === "__trash")} ${selectedFilter === "__trash" ? "!text-destructive !border-destructive/60" : "text-muted-foreground/50"}`}
          onClick={() => onSelectFilter?.("__trash")}
        >
          <Trash2 className="w-3 h-3 inline-block mr-1 -mt-0.5" />
          TRASH
          <span className="ml-1 text-muted-foreground/40">{resultCounts.__trash ?? 0}</span>
        </button>
        {isCreating ? (
          <input ref={createInputRef} value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onBlur={handleCreate}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setIsCreating(false); setNewFolderName(""); } }}
            placeholder="folder name..." className="bg-input border border-primary/50 rounded px-1.5 py-1 text-[10px] font-mono-share w-24 outline-none text-primary placeholder:text-muted-foreground/30" />
        ) : (
          <button className="px-2 py-1.5 flex items-center justify-center text-muted-foreground/40 hover:text-primary transition-colors" onClick={() => setIsCreating(true)} title="Create folder">
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent className="bg-card border-border sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-orbitron text-sm tracking-wider text-destructive">DISMANTLE_FOLDER?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="font-mono-share text-[11px] text-muted-foreground space-y-2">
                <p>This will permanently deallocate the folder <span className="text-foreground font-semibold">&quot;{deleteConfirm?.name}&quot;</span> from the grid.</p>
                <p className="text-primary/90">{deleteConfirm && deleteConfirm.count > 0 ? `WARNING: ${deleteConfirm.count} asset(s) currently in this folder will be REASSIGNED to UNFILED. They are not deleted.` : "No assets in this folder. Safe to proceed."}</p>
                <p className="text-destructive/80">This operation cannot be undone. Confirm to proceed.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-orbitron text-[10px]">CANCEL</AlertDialogCancel>
            <AlertDialogAction className="font-orbitron text-[10px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => { if (deleteConfirm && onDeleteFolder) { await onDeleteFolder(deleteConfirm.id); setDeleteConfirm(null); } }}>DISMANTLE</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Move to Folder Menu ─────────────────────────────────────────────────

function MoveToFolderMenu({
  folders,
  currentFolderId,
  onMove,
  onClose,
}: {
  folders: Folder[];
  currentFolderId: string | null | undefined;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Ignore clicks inside the menu itself
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    // Use setTimeout to avoid closing immediately on the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Mobile: fixed bottom sheet overlay — sits above the bottom nav bar
  const mobileSheet = (
    <div className="sm:hidden fixed inset-0 z-[200]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="absolute left-0 right-0 bg-card border-t border-border/60 rounded-t-xl shadow-2xl animate-slide-up"
        style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="px-4 py-2 text-[10px] font-orbitron tracking-wider text-muted-foreground/50 border-b border-border/40">
          MOVE_TO_FOLDER
        </div>
        <div className="overflow-y-auto max-h-[45vh] pb-3">
          <button
            className={`w-full text-left px-4 py-3.5 text-[12px] font-mono-share transition-colors flex items-center gap-2 ${!currentFolderId ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
            onClick={() => { onMove(null); onClose(); }}
          >
            UNFILED
          </button>
          {folders.filter((f) => !f.hidden).map((folder) => (
            <button
              key={folder.id}
              className={`w-full text-left px-4 py-3.5 text-[12px] font-mono-share transition-colors flex items-center gap-2 ${currentFolderId === folder.id ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
              onClick={() => { onMove(folder.id); onClose(); }}
            >
              <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
              {(folder.name ?? "").toUpperCase()}
            </button>
          ))}
          {folders.filter((f) => !f.hidden).length === 0 && (
            <div className="px-4 py-4 text-[11px] font-mono-share text-muted-foreground/40">
              No folders yet
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Desktop: absolute dropdown anchored to trigger button
  const desktopMenu = (
    <div
      ref={menuRef}
      className="hidden sm:block absolute right-0 top-full mt-1 z-[60] bg-card border border-border rounded shadow-lg py-1 min-w-[140px] max-h-[280px] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 text-[9px] font-orbitron tracking-wider text-muted-foreground/50 border-b border-border/50 mb-1 sticky top-0 bg-card z-10">
        MOVE_TO
      </div>
      <button
        className={`w-full text-left px-3 py-1.5 text-[10px] font-mono-share transition-colors flex items-center gap-1.5 ${!currentFolderId ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
        onClick={() => { onMove(null); onClose(); }}
      >
        UNFILED
      </button>
      {folders.filter((f) => !f.hidden).map((folder) => (
        <button
          key={folder.id}
          className={`w-full text-left px-3 py-1.5 text-[10px] font-mono-share transition-colors flex items-center gap-1.5 ${currentFolderId === folder.id ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
          onClick={() => { onMove(folder.id); onClose(); }}
        >
          <FolderOpen className="w-3 h-3 flex-shrink-0" />
          {(folder.name ?? "").toUpperCase()}
        </button>
      ))}
      {folders.length === 0 && (
        <div className="px-3 py-1.5 text-[10px] font-mono-share text-muted-foreground/40">
          No folders yet
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile bottom sheet — rendered at document level via portal feel */}
      {mobileSheet}
      {/* Desktop dropdown */}
      {desktopMenu}
    </>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

const ResultsGrid: React.FC<ResultsGridProps> = ({
  results,
  isLoading,
  elapsedSeconds = 0,
  loadingPhase,
  onClear,
  onDelete,
  onEditImage,
  onAnimateImage,
  folders = [],
  selectedFilter = "all",
  onSelectFilter,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolderHidden,
  onMoveToFolder,
  onBulkMoveToFolder,
  onBulkDelete,
  onEmptyTrash,
  searchQuery = "",
  onSearchChange,
  typeFilter = "all",
  onTypeFilterChange,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mobileIndex, setMobileIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const isTrashView = selectedFilter === "__trash";

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const confirmDelete = useCallback((id: string) => {
    setDeleteConfirmId(id);
  }, []);

  const executeDelete = useCallback(() => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      if (expandedId === deleteConfirmId) setExpandedId(null);
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, onDelete, expandedId]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ZIP export state
  const [zipExporting, setZipExporting] = useState(false);
  const [zipProgress, setZipProgress] = useState({ completed: 0, total: 0 });

  // Share CTA state — show after results appear
  const [shareCTADismissed, setShareCTADismissed] = useState(false);
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null);
  const showShareCTA = !isLoading && results.length > 0 && !shareCTADismissed;
  const prevResultsCount = useRef(results.length);
  useEffect(() => {
    if (results.length > prevResultsCount.current) {
      setShareCTADismissed(false);
      setLastShareUrl(null);
    }
    prevResultsCount.current = results.length;
  }, [results.length]);

  // Purge confirmation state
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);

  // PIN lock state
  const [unlockedFolders, setUnlockedFolders] = useState<Set<string>>(new Set());
  const [pinDialog, setPinDialog] = useState<{
    mode: "set" | "unlock" | "remove";
    folderId: string;
    folderName: string;
  } | null>(null);

  // Resolve display name for any folder ID (including built-in __unfiled / __all)
  const getFolderName = useCallback((folderId: string): string => {
    if (folderId === "__unfiled") return "UNFILED";
    if (folderId === "__all") return "ALL";
    if (folderId === "__vault") return "VAULT";
    return folders.find((f) => f.id === folderId)?.name || folderId;
  }, [folders]);

  const handleRequestUnlock = useCallback((folderId: string) => {
    setPinDialog({ mode: "unlock", folderId, folderName: getFolderName(folderId) });
  }, [getFolderName]);

  const handleSetPin = useCallback((folderId: string) => {
    setPinDialog({ mode: "set", folderId, folderName: getFolderName(folderId) });
  }, [getFolderName]);

  const handleRemovePin = useCallback((folderId: string) => {
    setPinDialog({ mode: "remove", folderId, folderName: getFolderName(folderId) });
  }, [getFolderName]);

  const handleLockFolder = useCallback((folderId: string) => {
    setUnlockedFolders((prev) => {
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
    // If we're currently viewing this folder, switch to "none" so locked content isn't visible
    const filterForId = folderId === "__unfiled" ? "unfiled" : folderId === "__all" ? "all" : folderId;
    if (onSelectFilter && selectedFilter === filterForId) {
      onSelectFilter("none");
    }
  }, [onSelectFilter, selectedFilter]);

  // Convert a PIN storage ID back to the filter value for onSelectFilter
  const pinIdToFilter = useCallback((pinId: string): string => {
    if (pinId === "__unfiled") return "unfiled";
    if (pinId === "__all") return "all";
    return pinId;
  }, []);

  const handlePinSubmit = useCallback(async (pin: string) => {
    if (!pinDialog) return;
    const { mode, folderId } = pinDialog;

    if (mode === "set") {
      await setFolderPin(folderId, pin);
      setPinDialog(null);
    } else if (mode === "unlock") {
      const valid = await verifyPin(folderId, pin);
      if (valid) {
        setUnlockedFolders((prev) => new Set([...prev, folderId]));
        setPinDialog(null);
        if (onSelectFilter) onSelectFilter(pinIdToFilter(folderId));
      } else {
        setPinDialog(null);
        setTimeout(() => {
          setPinDialog({ mode: "unlock", folderId, folderName: getFolderName(folderId) });
        }, 100);
      }
    } else if (mode === "remove") {
      const valid = await verifyPin(folderId, pin);
      if (valid) {
        removeFolderPin(folderId);
        setUnlockedFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
        setPinDialog(null);
      } else {
        setPinDialog(null);
        setTimeout(() => {
          setPinDialog({ mode: "remove", folderId, folderName: getFolderName(folderId) });
        }, 100);
      }
    }
  }, [pinDialog, getFolderName, pinIdToFilter, onSelectFilter]);

  // Exit select mode when switching filters
  const prevFilter = useRef(selectedFilter);
  useEffect(() => {
    if (prevFilter.current !== selectedFilter) {
      exitSelectMode();
      prevFilter.current = selectedFilter;
    }
  }, [selectedFilter, exitSelectMode]);

  // Filter results based on selected folder (trash excluded from "all" and "unfiled")
  const filteredResults = React.useMemo(() => {
    if (selectedFilter === "none") return [];
    if (selectedFilter === "__trash") return results.filter((r) => r.folderId === "__trash");
    if (selectedFilter === "all") return results.filter((r) => r.folderId !== "__trash");
    if (selectedFilter === "unfiled") return results.filter((r) => !r.folderId || r.folderId === "");
    return results.filter((r) => r.folderId === selectedFilter);
  }, [results, selectedFilter]);

  // Compute result counts per folder for badges
  const resultCounts = React.useMemo(() => {
    const nonTrash = results.filter((r) => r.folderId !== "__trash");
    const counts: Record<string, number> = {
      __total: nonTrash.length,
      __unfiled: results.filter((r) => !r.folderId || r.folderId === "").length,
      __trash: results.filter((r) => r.folderId === "__trash").length,
    };
    for (const folder of folders) {
      counts[folder.id] = results.filter((r) => r.folderId === folder.id).length;
    }
    return counts;
  }, [results, folders]);

  const expandedResult = filteredResults.find((r) => r.id === expandedId);

  const clampedIndex = Math.min(mobileIndex, Math.max(filteredResults.length - 1, 0));

  const swipeHandlers = useSwipe({
    onSwipeLeft: () => {
      if (clampedIndex < filteredResults.length - 1) setMobileIndex(clampedIndex + 1);
    },
    onSwipeRight: () => {
      if (clampedIndex > 0) setMobileIndex(clampedIndex - 1);
    },
    threshold: 40,
  });

  // Reset index when results change
  React.useEffect(() => {
    setMobileIndex(0);
  }, [filteredResults.length]);

  const handleCopyPrompt = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* clipboard blocked */ }
  }, []);

  const handleMove = useCallback(async (resultId: string, folderId: string | null) => {
    if (onMoveToFolder) {
      await onMoveToFolder(resultId, folderId);
    }
  }, [onMoveToFolder]);

  const [sharingId, setSharingId] = useState<string | null>(null);
  const refCodeRef = useRef<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth-token");
    if (!token) return;
    const apiBase = (import.meta.env.VITE_API_URL as string) || "/api";
    fetch(`${apiBase}/referral`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "get-code" }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.code) refCodeRef.current = d.code; })
      .catch(() => {});
  }, []);

  /** Copy or share the link from a share API response */
  const copyOrShareLink = useCallback(async (data: { shareUrl: string }, _result: GrokResult) => {
    const shareLink = refCodeRef.current
      ? `${data.shareUrl}?ref=${refCodeRef.current}`
      : data.shareUrl;

    setLastShareUrl(shareLink);

    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    if (mobile && navigator.share) {
      try {
        await navigator.share({ title: "Grok Runner", url: shareLink });
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return;
      }
    }

    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareLink);
        copied = true;
      } catch { /* clipboard blocked without user gesture */ }
    }
    if (!copied) {
      const ta = document.createElement("textarea");
      ta.value = shareLink;
      ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { copied = document.execCommand("copy"); } catch { /* fallback failed */ }
      document.body.removeChild(ta);
    }

    if (copied) {
      toast.success("Link copied! Share it on X or Reddit to show it off.");
    } else if (navigator.share) {
      try {
        await navigator.share({ title: "Grok Runner", url: shareLink });
      } catch { /* user cancelled */ }
    } else {
      toast.success("Share link ready — tap to copy:", { description: shareLink });
    }
  }, []);

  /** Upload media to Blob and copy/share the link */
  const handleShare = useCallback(async (result: GrokResult) => {
    setSharingId(result.id);
    try {
      const shareBase = (import.meta.env.VITE_API_URL as string) || "/api";

      // For external URLs (videos, remote images) let the server download directly
      // to avoid Vercel's ~4.5MB request body limit
      if (result.url.startsWith("https://")) {
        const res = await fetch(`${shareBase}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaUrl: result.url,
            mediaType: result.type,
            prompt: result.revised_prompt || "",
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Upload failed (${res.status})`);
        }
        const data = await res.json();
        await copyOrShareLink(data, result);
        return;
      }

      // For local data (IndexedDB / blob: URLs) send as base64
      let mediaBase64 = result.url;
      if (!mediaBase64.startsWith("data:")) {
        const stored = await getResultDataUrl(result.id).catch(() => null);
        if (stored && stored.startsWith("data:")) {
          mediaBase64 = stored;
        } else if (mediaBase64.startsWith("blob:")) {
          const resp = await fetch(mediaBase64);
          if (!resp.ok) throw new Error("Failed to fetch media");
          const blob = await resp.blob();
          mediaBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("FileReader failed"));
            reader.readAsDataURL(blob);
          });
        }
      }

      const res = await fetch(`${shareBase}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaBase64,
          mediaType: result.type,
          prompt: result.revised_prompt || "",
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      await copyOrShareLink(data, result);
    } catch (err: any) {
      console.error("[share] error:", err);
      toast.error("Failed to create share link", {
        description: err?.message || "Unknown error",
      });
    } finally {
      setSharingId(null);
    }
  }, []);

  /** Upload to Blob first, then open Grokker with the URL */
  const handleGrokkerPost = useCallback(async (result: GrokResult) => {
    setSharingId(result.id);
    try {
      let mediaBase64 = result.url;
      if (!mediaBase64.startsWith("data:")) {
        const stored = await getResultDataUrl(result.id).catch(() => null);
        if (stored && stored.startsWith("data:")) {
          mediaBase64 = stored;
        } else if (mediaBase64.startsWith("http") || mediaBase64.startsWith("blob:")) {
          const resp = await fetch(mediaBase64);
          if (!resp.ok) throw new Error("Failed to fetch media");
          const blob = await resp.blob();
          mediaBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("FileReader failed"));
            reader.readAsDataURL(blob);
          });
        }
      }
      const shareBase2 = (import.meta.env.VITE_API_URL as string) || "/api";
      const res = await fetch(`${shareBase2}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaBase64,
          mediaType: result.type,
          prompt: result.revised_prompt || "",
        }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      const grokkerUrl = "https://grokker.gltch.app";
      window.open(`${grokkerUrl}/dashboard/new-post?media=${encodeURIComponent(data.r2Url)}&caption=${encodeURIComponent(result.revised_prompt || "")}`, "_blank");
    } catch {
      toast.error("Failed to upload media for Grokker");
    } finally {
      setSharingId(null);
    }
  }, []);

  const hasFolders = folders.length > 0 || !!onCreateFolder;

  if (filteredResults.length === 0 && !isLoading) {
    return (
      <div className="space-y-2">
        {/* Folder bar even when empty */}
        {hasFolders && onSelectFilter && onCreateFolder && (
          <FolderBar
            folders={folders}
            selectedFilter={selectedFilter}
            onSelectFilter={onSelectFilter}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onToggleFolderHidden={onToggleFolderHidden}
            resultCounts={resultCounts}
            unlockedFolders={unlockedFolders}
            onRequestUnlock={handleRequestUnlock}
            onSetPin={handleSetPin}
            onRemovePin={handleRemovePin}
            onLockFolder={handleLockFolder}
          />
        )}
        <div className="border border-dashed border-border rounded p-12 text-center">
          <div className="font-mono-share text-sm text-muted-foreground tracking-wider mb-2">
            <span className="text-primary/40">$</span>{" "}
            {selectedFilter === "none" ? "echo 'SELECT A FOLDER TO VIEW CONTENTS'" : "ls ./output/"}
          </div>
          <div className="font-mono-share text-xs text-muted-foreground/40">
            {selectedFilter === "none"
              ? "// choose a folder above to decrypt and display files"
              : selectedFilter !== "all" && results.length > 0
                ? "(no results in this folder)"
                : "(empty) — submit a prompt to generate results"
            }
          </div>
        </div>

        {/* PIN Dialog (empty state) */}
        {pinDialog && (
          <PinDialog
            mode={pinDialog.mode}
            folderName={pinDialog.folderName}
            onSubmit={handlePinSubmit}
            onCancel={() => setPinDialog(null)}
          />
        )}
      </div>
    );
  }

  const currentResult = filteredResults[clampedIndex];

  const ImageActions = ({ result, size = "sm" }: { result: GrokResult; size?: "sm" | "icon" }) => {
    if (result.type !== "image") return null;
    const iconSize = size === "icon" ? "w-4 h-4" : "w-3 h-3";
    return (
      <>
        {onEditImage && (
          <Button
            size={size}
            variant="ghost"
            className="text-primary hover:bg-primary/20 text-xs gap-1"
            onClick={(e) => { e.stopPropagation(); onEditImage(result.url); }}
            title="Edit this image"
          >
            <Pencil className={iconSize} />
            {size === "sm" && <span>Edit</span>}
          </Button>
        )}
        {onAnimateImage && (
          <Button
            size={size}
            variant="ghost"
            className="text-secondary hover:bg-secondary/20 text-xs gap-1"
            onClick={(e) => { e.stopPropagation(); onAnimateImage(result.url); }}
            title="Animate this image"
          >
            <Film className={iconSize} />
            {size === "sm" && <span>Animate</span>}
          </Button>
        )}
      </>
    );
  };

  /** Prompt display with copy button */
  const PromptDisplay = ({ result, className = "" }: { result: GrokResult; className?: string }) => {
    if (!result.revised_prompt) return null;
    const isCopied = copiedId === result.id;
    return (
      <div className={className}>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="font-orbitron text-[9px] text-muted-foreground/60 tracking-wider">
            PROMPT
          </div>
          <button
            onClick={() => handleCopyPrompt(result.id, result.revised_prompt!)}
            className="p-0.5 rounded hover:bg-primary/10 transition-colors"
            title="Copy prompt"
          >
            {isCopied ? (
              <Check className="w-3 h-3 text-primary" />
            ) : (
              <Copy className="w-3 h-3 text-muted-foreground/40 hover:text-primary" />
            )}
          </button>
        </div>
        <p className="font-rajdhani text-xs text-foreground/70 leading-relaxed line-clamp-3">
          {result.revised_prompt}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Folder bar — sticky immediately below terminal top bar */}
      {hasFolders && onSelectFilter && onCreateFolder && (
        <div
          id="library-folder-bar"
          className="sticky z-30 bg-card/90 backdrop-blur-md -mx-4 px-4 pt-1.5 pb-1 border-b border-border/40"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 28px)' }}
        >
          <FolderBar
            folders={folders}
            selectedFilter={selectedFilter}
            onSelectFilter={onSelectFilter}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onToggleFolderHidden={onToggleFolderHidden}
            resultCounts={resultCounts}
            unlockedFolders={unlockedFolders}
            onRequestUnlock={handleRequestUnlock}
            onSetPin={handleSetPin}
            onRemovePin={handleRemovePin}
            onLockFolder={handleLockFolder}
          />
        </div>
      )}

      {/* Search + type filter — sticky below folder bar.
          Folder bar = terminal(28px) + pt-1.5(6px) + button(~36px) + pb-1(4px) + border(1px) = ~47px */}
      {onSearchChange && onTypeFilterChange && (
        <div
          className="sticky z-20 bg-card/95 backdrop-blur-md -mx-4 px-4 py-2 border-b border-border/40"
          style={{ top: `calc(env(safe-area-inset-top, 0px) + 28px + ${hasFolders ? "47px" : "0px"})` }}
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="search prompts..."
                className="w-full pl-8 pr-8 py-1.5 bg-card/60 border border-border/50 rounded text-sm font-mono-share text-foreground/80 placeholder:text-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => onSearchChange("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-primary transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center border border-border/50 rounded overflow-hidden">
              {(["all", "image", "video"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => onTypeFilterChange(t)}
                  className={`px-2.5 py-1.5 text-[10px] font-mono-share tracking-wider transition-colors ${
                    typeFilter === t
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/20"
                  }`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="font-orbitron text-xs tracking-wider text-muted-foreground">
          OUTPUT [{filteredResults.length}]
        </div>
        {filteredResults.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              disabled={zipExporting}
              onClick={async () => {
                // DOWNLOAD ALL = everything except trash, regardless of current folder filter
                const toExport = results.filter((r) => r.folderId !== "__trash");
                setZipExporting(true);
                setZipProgress({ completed: 0, total: toExport.length });
                try {
                  const folderMap: Record<string, string> = {};
                  for (const f of folders) folderMap[f.id] = f.name;
                  const { included, skipped } = await exportLibraryAsZip(toExport, folderMap, (c, t) =>
                    setZipProgress({ completed: c, total: t })
                  );
                  if (skipped > 0) {
                    toast.warning(`ZIP saved — ${included} file${included !== 1 ? "s" : ""} included, ${skipped} skipped (expired links).`);
                  } else {
                    toast.success(`ZIP saved — ${included} file${included !== 1 ? "s" : ""} exported.`);
                  }
                } catch {
                  toast.error("ZIP export failed.");
                } finally {
                  setZipExporting(false);
                }
              }}
              className="text-primary hover:text-primary/80 font-mono-share text-[10px] sm:text-xs h-7 px-2 sm:px-3"
            >
              {zipExporting ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  {zipProgress.total > 0 ? `${Math.round((zipProgress.completed / zipProgress.total) * 100)}%` : "ZIP"}
                </>
              ) : (
                <>
                  <Download className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">DOWNLOAD ALL ({results.filter((r) => r.folderId !== "__trash").length})</span>
                </>
              )}
            </Button>
            {selectedFilter !== "all" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={zipExporting}
                onClick={async () => {
                  setZipExporting(true);
                  setZipProgress({ completed: 0, total: filteredResults.length });
                  try {
                    const folderMap: Record<string, string> = {};
                    for (const f of folders) folderMap[f.id] = f.name;
                    const { included, skipped } = await exportLibraryAsZip(filteredResults, folderMap, (c, t) =>
                      setZipProgress({ completed: c, total: t })
                    );
                    if (skipped > 0) {
                      toast.warning(`ZIP saved — ${included} file${included !== 1 ? "s" : ""} included, ${skipped} skipped (expired links).`);
                    } else {
                      toast.success(`ZIP saved — ${included} file${included !== 1 ? "s" : ""} exported.`);
                    }
                  } catch {
                    toast.error("ZIP export failed.");
                  } finally {
                    setZipExporting(false);
                  }
                }}
                className="text-primary/60 hover:text-primary/80 font-mono-share text-[10px] sm:text-xs h-7 px-2 sm:px-3"
              >
                <Archive className="w-3 h-3 sm:mr-1" />
                <span className="hidden sm:inline">EXPORT VIEW</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
              className={`font-mono-share text-[10px] sm:text-xs h-7 px-2 sm:px-3 ${selectMode ? "text-primary" : "text-primary/60 hover:text-primary/80"}`}
            >
              <ListChecks className="w-3 h-3 sm:mr-1" />
              <span className="hidden sm:inline">{selectMode ? "CANCEL" : "SELECT"}</span>
            </Button>
            {isTrashView && onEmptyTrash && (resultCounts.__trash ?? 0) > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPurgeConfirmOpen(true)}
                className="text-destructive hover:text-destructive/80 font-mono-share text-[10px] sm:text-xs h-7 px-2 sm:px-3"
              >
                <Trash2 className="w-3 h-3 sm:mr-1" />
                <span className="hidden sm:inline">EMPTY TRASH</span>
              </Button>
            )}
            {!isTrashView && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPurgeConfirmOpen(true)}
                className="text-destructive hover:text-destructive/80 font-mono-share text-[10px] sm:text-xs h-7 px-2 sm:px-3"
              >
                <Trash2 className="w-3 h-3 sm:mr-1" />
                <span className="hidden sm:inline">PURGE</span>
              </Button>
            )}
          </div>
        )}

        {/* Purge / Empty Trash confirmation dialog */}
        <AlertDialog open={purgeConfirmOpen} onOpenChange={setPurgeConfirmOpen}>
          <AlertDialogContent className="bg-card border-destructive/40 sm:max-w-md shadow-[0_0_30px_rgba(255,0,0,0.15)]">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-orbitron text-sm tracking-wider text-destructive flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                {isTrashView ? "EMPTY_TRASH" : "CONFIRM_PURGE_OPERATION"}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="font-mono-share text-[11px] text-muted-foreground space-y-3">
                  <p className="text-destructive font-semibold text-xs">
                    ⚠ WARNING: This action is IRREVERSIBLE
                  </p>
                  {isTrashView ? (
                    <p>
                      Permanently delete{" "}
                      <span className="text-foreground font-bold">{resultCounts.__trash ?? 0} item{(resultCounts.__trash ?? 0) !== 1 ? "s" : ""}</span>{" "}
                      from trash. They cannot be recovered.
                    </p>
                  ) : (
                    <>
                      <p>
                        You are about to permanently delete{" "}
                        <span className="text-foreground font-bold">{results.length} generation{results.length !== 1 ? "s" : ""}</span>{" "}
                        from your library. All images and videos will be erased from local storage.
                      </p>
                      <p className="text-primary/90">
                        TIP: Use <span className="font-semibold">DOWNLOAD ALL</span> to back up your library before purging.
                      </p>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="font-orbitron text-[10px]">ABORT</AlertDialogCancel>
              <AlertDialogAction
                className="font-orbitron text-[10px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  setPurgeConfirmOpen(false);
                  if (isTrashView && onEmptyTrash) onEmptyTrash();
                  else onClear();
                }}
              >
                {isTrashView ? "EMPTY TRASH" : "PURGE ALL DATA"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Single-item delete confirmation */}
        <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
          <AlertDialogContent className="bg-card border-destructive/40 sm:max-w-sm shadow-[0_0_30px_rgba(255,0,0,0.15)]">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-orbitron text-sm tracking-wider text-destructive flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                {isTrashView ? "DELETE_FOREVER" : "CONFIRM_DELETE"}
              </AlertDialogTitle>
              <AlertDialogDescription className="font-mono-share text-[11px] text-muted-foreground">
                {isTrashView
                  ? "This will permanently delete this item. It cannot be recovered."
                  : "This item will be moved to trash. You can restore it later from the Trash tab."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="font-orbitron text-[10px]">CANCEL</AlertDialogCancel>
              <AlertDialogAction
                className="font-orbitron text-[10px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={executeDelete}
              >
                {isTrashView ? "DELETE FOREVER" : "MOVE TO TRASH"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Share CTA — shown after generation */}
      <ShareCTA
        visible={showShareCTA}
        onDismiss={() => setShareCTADismissed(true)}
        latestResult={results[0] ?? null}
        onShareResult={handleShare}
        sharingId={sharingId}
        lastShareUrl={lastShareUrl}
      />

      {/* Loading state — CSS-only, zero WebGL */}
      {isLoading && (
        <div className={`border rounded p-1 ${loadingPhase ? "border-accent/40" : "border-primary/30"}`}>
          <div className="loader-scanlines bg-muted rounded flex flex-col items-center justify-center gap-4 py-10 sm:py-14 relative overflow-hidden">

            {/* Scanline sweep — single element, compositor-only */}
            <div className="loader-scanline absolute inset-x-0 top-0 h-[2px] pointer-events-none" style={{ background: loadingPhase ? "hsl(var(--accent)/0.7)" : "hsl(var(--primary)/0.7)" }} />

            {/* Ring + label */}
            <div className="relative flex items-center justify-center w-20 h-20">
              {/* Outer ring */}
              <svg className="absolute inset-0 w-full h-full loader-ring-spin" viewBox="0 0 80 80" fill="none">
                <circle cx="40" cy="40" r="36" stroke={loadingPhase ? "hsl(270 100% 65% / 0.15)" : "hsl(180 100% 50% / 0.15)"} strokeWidth="2" />
                <circle
                  cx="40" cy="40" r="36"
                  stroke={loadingPhase ? "hsl(270 100% 65%)" : "hsl(180 100% 50%)"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray="60 166"
                  style={{ filter: `drop-shadow(0 0 4px ${loadingPhase ? "hsl(270 100% 65% / 0.8)" : "hsl(180 100% 50% / 0.8)"})` }}
                />
              </svg>
              {/* Inner counter-ring */}
              <svg className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] loader-ring-counter" viewBox="0 0 48 48" fill="none">
                <circle
                  cx="24" cy="24" r="20"
                  stroke={loadingPhase ? "hsl(300 100% 60% / 0.5)" : "hsl(180 100% 50% / 0.35)"}
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeDasharray="20 106"
                />
              </svg>
              {/* Center dot */}
              <div className="w-2 h-2 rounded-full loader-dot-pulse" style={{ background: loadingPhase ? "hsl(var(--accent))" : "hsl(var(--primary))" }} />
            </div>

            {/* Status label */}
            <div className="flex items-center gap-2">
              <span className={`font-orbitron text-[10px] tracking-widest ${loadingPhase ? "text-accent" : "text-primary"}`}>
                {loadingPhase?.includes("start frame") ? "PHASE 1" : loadingPhase?.includes("video") || loadingPhase?.includes("Rendering") ? "RENDERING" : "GENERATING"}
              </span>
            </div>

            {/* Phase / elapsed */}
            <div className="flex flex-col items-center gap-1.5 text-center px-4">
              <div className={`font-mono-share text-[10px] ${loadingPhase ? "text-accent/80" : "text-primary/70"}`}>
                {loadingPhase || "PROCESSING REQUEST..."}
              </div>
              {elapsedSeconds > 0 && (
                <div className={`font-mono-share text-base font-bold tabular-nums ${loadingPhase ? "text-accent" : "text-primary"}`}>
                  {Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")}:{(elapsedSeconds % 60).toString().padStart(2, "0")}
                </div>
              )}
            </div>

            {/* Hint */}
            <div className="font-mono-share text-[9px] text-muted-foreground/40">
              {elapsedSeconds > 120 ? "Complex renders can take 3–5 min" : elapsedSeconds > 30 ? "GPU is working hard..." : "Please wait"}
            </div>
          </div>
        </div>
      )}

      {/* Mobile swipeable carousel */}
      {filteredResults.length > 0 && (
        <div className="sm:hidden">
          <div
            className="relative border border-border rounded overflow-hidden bg-card"
            {...swipeHandlers}
          >
            {currentResult?.type === "image" ? (
              <img
                src={currentResult.url}
                alt={currentResult.revised_prompt || "Generated image"}
                className="w-full object-contain bg-black/40"
                style={{ maxHeight: "70vh" }}
                loading="lazy"
              />
            ) : currentResult ? (
              <video
                src={currentResult.url}
                className="w-full object-contain bg-black/40"
                style={{ maxHeight: "70vh" }}
                controls
                muted
                playsInline
                // @ts-ignore
                webkit-playsinline="true"
                preload="metadata"
              />
            ) : null}

            {/* Nav arrows */}
            {filteredResults.length > 1 && (
              <>
                <button
                  onClick={() => clampedIndex > 0 && setMobileIndex(clampedIndex - 1)}
                  disabled={clampedIndex === 0}
                  className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-background/70 text-foreground disabled:opacity-20 transition-opacity"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => clampedIndex < filteredResults.length - 1 && setMobileIndex(clampedIndex + 1)}
                  disabled={clampedIndex === filteredResults.length - 1}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-background/70 text-foreground disabled:opacity-20 transition-opacity"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Type badge */}
            <div className="absolute top-2 left-2 font-mono-share text-[9px] bg-background/80 text-primary px-1.5 py-0.5 rounded">
              {(currentResult?.type ?? "unknown").toUpperCase()}
            </div>

            {/* Counter badge */}
            {filteredResults.length > 1 && (
              <div className="absolute top-2 right-2 font-mono-share text-[9px] bg-background/80 text-muted-foreground px-1.5 py-0.5 rounded">
                {clampedIndex + 1}/{filteredResults.length}
              </div>
            )}
          </div>

          {/* Revised prompt */}
          {currentResult && (
            <PromptDisplay result={currentResult} className="p-2.5 border border-t-0 border-border/50 rounded-b" />
          )}

          {/* Mobile action bar — two rows to prevent overflow */}
          <div className="border border-t-0 border-border/30 rounded-b">
            {/* Row 1: View / Edit / Animate */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/20">
              <Button
                size="sm"
                variant="ghost"
                className="text-primary text-xs gap-1 h-8 px-2.5 flex-1"
                onClick={() => currentResult && setExpandedId(currentResult.id)}
              >
                <Maximize2 className="w-3.5 h-3.5" />
                View
              </Button>
              {currentResult?.type === "image" && onEditImage && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-primary text-xs gap-1 h-8 px-2.5 flex-1"
                  onClick={(e) => { e.stopPropagation(); onEditImage(currentResult.url); }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
              )}
              {currentResult?.type === "image" && onAnimateImage && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-secondary text-xs gap-1 h-8 px-2.5 flex-1"
                  onClick={(e) => { e.stopPropagation(); onAnimateImage(currentResult.url); }}
                >
                  <Film className="w-3.5 h-3.5" />
                  Animate
                </Button>
              )}
            </div>
            {/* Row 2: utility actions */}
            <div className="flex items-center justify-around px-1 py-1">
              {/* Move to folder */}
              {onMoveToFolder && currentResult && (
                <div className="relative">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-primary h-9 w-9"
                    onClick={() => setMoveMenuId(moveMenuId === currentResult.id ? null : currentResult.id)}
                    title="Move to folder"
                  >
                    <FolderInput className="w-4 h-4" />
                  </Button>
                  {moveMenuId === currentResult.id && (
                    <MoveToFolderMenu
                      folders={folders}
                      currentFolderId={currentResult.folderId}
                      onMove={(fid) => handleMove(currentResult.id, fid)}
                      onClose={() => setMoveMenuId(null)}
                    />
                  )}
                </div>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="text-cyan-400 h-9 w-9"
                onClick={() => currentResult && handleShare(currentResult)}
                disabled={!!currentResult && sharingId === currentResult.id}
                title="Share link"
              >
                {currentResult && sharingId === currentResult.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-secondary h-9 w-9"
                onClick={() => currentResult && handleGrokkerPost(currentResult)}
                disabled={!!currentResult && sharingId === currentResult.id}
                title="Post to Grokker"
              >
                <Sparkles className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-primary h-9 w-9"
                onClick={() => currentResult && downloadMedia(currentResult.url, currentResult.type)}
                title="Download / Save"
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" className="text-primary h-9 w-9" asChild>
                <a href={currentResult?.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:bg-destructive/20 h-9 w-9"
                onClick={() => currentResult && confirmDelete(currentResult.id)}
                title="Delete this item"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Dot indicators */}
          {filteredResults.length > 1 && (
            <div className="flex justify-center gap-1.5 pt-2">
              {filteredResults.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setMobileIndex(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${i === clampedIndex
                    ? "bg-primary w-4"
                    : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                    }`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Desktop grid */}
      <div className="hidden sm:grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {filteredResults.map((result, idx) => (
          <div
            key={result.id}
            className={`group relative border rounded overflow-hidden bg-card transition-all animate-slide-up ${
              selectMode && selectedIds.has(result.id)
                ? "border-primary ring-1 ring-primary/40"
                : "border-border hover:border-primary/50"
            }`}
            style={{ animationDelay: `${idx * 50}ms` }}
            onClick={selectMode ? () => toggleSelect(result.id) : undefined}
          >
            {result.type === "image" ? (
              <img
                src={result.url}
                alt={result.revised_prompt || "Generated image"}
                className="w-full object-contain bg-black/40"
                style={{ minHeight: "200px", maxHeight: "400px" }}
                loading="lazy"
              />
            ) : (
              <video
                src={result.url}
                className="w-full object-contain bg-black/40"
                style={{ minHeight: "150px", maxHeight: "400px" }}
                controls={!selectMode}
                muted
                playsInline
                // @ts-ignore
                webkit-playsinline="true"
                preload="metadata"
              />
            )}

            {/* Select mode checkbox */}
            {selectMode && (
              <div className="absolute top-2 left-2 z-10">
                {selectedIds.has(result.id) ? (
                  <CheckSquare className="w-5 h-5 text-primary drop-shadow-md" />
                ) : (
                  <Square className="w-5 h-5 text-muted-foreground/60 drop-shadow-md" />
                )}
              </div>
            )}

            {/* Overlay — desktop hover (stays visible when move menu is open) */}
            <div className={`absolute inset-0 bg-background/80 transition-opacity flex items-center justify-center gap-2 ${
              selectMode ? "opacity-0 pointer-events-none" : (moveMenuId === result.id ? "opacity-100" : "opacity-0 group-hover:opacity-100")
              }`}>
              <Button
                size="icon"
                variant="ghost"
                className="text-primary hover:bg-primary/20"
                onClick={() => setExpandedId(result.id)}
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
              <ImageActions result={result} size="icon" />
              {/* Move to folder button */}
              {onMoveToFolder && (
                <div className="relative">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-primary hover:bg-primary/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMoveMenuId(moveMenuId === result.id ? null : result.id);
                    }}
                    title="Move to folder"
                  >
                    <FolderInput className="w-4 h-4" />
                  </Button>
                  {moveMenuId === result.id && (
                    <MoveToFolderMenu
                      folders={folders}
                      currentFolderId={result.folderId}
                      onMove={(fid) => handleMove(result.id, fid)}
                      onClose={() => setMoveMenuId(null)}
                    />
                  )}
                </div>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="text-cyan-400 hover:bg-cyan-400/20"
                onClick={() => handleShare(result)}
                disabled={sharingId === result.id}
                title="Share link"
              >
                {sharingId === result.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-secondary hover:bg-secondary/20"
                onClick={() => handleGrokkerPost(result)}
                disabled={sharingId === result.id}
                title="Post to Grokker"
              >
                <Sparkles className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-primary hover:bg-primary/20"
                onClick={() => downloadMedia(result.url, result.type)}
                title="Download / Save"
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-primary hover:bg-primary/20"
                asChild
              >
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:bg-destructive/20"
                onClick={() => confirmDelete(result.id)}
                title="Delete this item"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            {/* Type badge */}
            <div className={`absolute top-2 font-mono-share text-[9px] bg-background/80 text-primary px-1.5 py-0.5 rounded ${selectMode ? "left-9" : "left-2"}`}>
              {(result.type ?? "unknown").toUpperCase()}
            </div>

            {/* Folder badge */}
            {result.folderId && (
              <div className="absolute top-2 right-2 font-mono-share text-[9px] bg-background/80 text-secondary px-1.5 py-0.5 rounded flex items-center gap-1">
                <FolderOpen className="w-2.5 h-2.5" />
                {(folders.find((f) => f.id === result.folderId)?.name || "").toUpperCase()}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Floating multi-select action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-card/95 backdrop-blur border border-primary/30 rounded-lg shadow-[0_0_20px_rgba(168,85,247,0.15)] px-4 py-2.5">
          <span className="font-mono-share text-xs text-primary mr-1">{selectedIds.size} selected</span>

          {/* Select all / none */}
          <Button variant="ghost" size="sm" className="font-mono-share text-[10px]"
            onClick={() => {
              if (selectedIds.size === filteredResults.length)
                setSelectedIds(new Set());
              else
                setSelectedIds(new Set(filteredResults.map((r) => r.id)));
            }}
          >
            {selectedIds.size === filteredResults.length ? "NONE" : "ALL"}
          </Button>

          {/* Trash-view: Restore + Delete Forever */}
          {isTrashView ? (
            <>
              <Button variant="outline" size="sm" className="font-mono-share text-[10px] text-primary border-primary/30 gap-1"
                onClick={async () => {
                  if (!onBulkMoveToFolder) return;
                  const ids = Array.from(selectedIds);
                  await onBulkMoveToFolder(ids, null);
                  exitSelectMode();
                  toast.success(`${ids.length} item(s) restored`);
                }}
              >
                <RotateCcw className="w-3 h-3" /> RESTORE
              </Button>
              <Button variant="outline" size="sm" className="font-mono-share text-[10px] text-destructive border-destructive/30 gap-1"
                onClick={async () => {
                  if (!onBulkDelete) return;
                  const ids = Array.from(selectedIds);
                  await onBulkDelete(ids);
                  exitSelectMode();
                  toast.success(`${ids.length} item(s) permanently deleted`);
                }}
              >
                <XCircle className="w-3 h-3" /> DELETE FOREVER
              </Button>
            </>
          ) : (
            <>
              {/* Move to folder dropdown */}
              {onBulkMoveToFolder && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="font-mono-share text-[10px] text-primary border-primary/30 gap-1">
                      <FolderInput className="w-3 h-3" /> MOVE TO...
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="min-w-[140px] bg-card border-border max-h-60 overflow-y-auto">
                    <DropdownMenuItem className="text-[10px] py-1.5 font-mono-share cursor-pointer" onSelect={async () => {
                      const ids = Array.from(selectedIds);
                      await onBulkMoveToFolder(ids, null);
                      exitSelectMode();
                      toast.success(`${ids.length} item(s) moved to UNFILED`);
                    }}>
                      UNFILED
                    </DropdownMenuItem>
                    {folders.filter((f) => !f.hidden).map((f) => (
                      <DropdownMenuItem key={f.id} className="text-[10px] py-1.5 font-mono-share cursor-pointer" onSelect={async () => {
                        const ids = Array.from(selectedIds);
                        await onBulkMoveToFolder(ids, f.id);
                        exitSelectMode();
                        toast.success(`${ids.length} item(s) moved to ${(f.name ?? "").toUpperCase()}`);
                      }}>
                        <FolderOpen className="w-3 h-3 mr-1.5" /> {(f.name ?? "").toUpperCase()}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {/* Trash selected */}
              {onBulkMoveToFolder && (
                <Button variant="outline" size="sm" className="font-mono-share text-[10px] text-destructive border-destructive/30 gap-1"
                  onClick={async () => {
                    const ids = Array.from(selectedIds);
                    await onBulkMoveToFolder(ids, "__trash");
                    exitSelectMode();
                    toast.success(`${ids.length} item(s) moved to trash`);
                  }}
                >
                  <Trash2 className="w-3 h-3" /> TRASH
                </Button>
              )}
            </>
          )}

          <Button variant="ghost" size="sm" className="font-mono-share text-[10px] text-muted-foreground" onClick={exitSelectMode}>
            CANCEL
          </Button>
        </div>
      )}

      {/* PIN Dialog */}
      {pinDialog && (
        <PinDialog
          mode={pinDialog.mode}
          folderName={pinDialog.folderName}
          onSubmit={handlePinSubmit}
          onCancel={() => setPinDialog(null)}
        />
      )}

      {/* Expanded modal */}
      {expandedResult && (
        <div
          className="fixed inset-0 z-50 bg-background/95 flex items-center justify-center p-3 sm:p-6"
          onClick={() => setExpandedId(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] w-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              {/* Action buttons in expanded view */}
              <div className="flex gap-2 flex-wrap">
                {expandedResult.type === "image" && onEditImage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-primary border-primary/30 hover:bg-primary/10 text-xs gap-1.5"
                    onClick={() => { onEditImage(expandedResult.url); setExpandedId(null); }}
                  >
                    <Pencil className="w-3 h-3" />
                    Edit Image
                  </Button>
                )}
                {expandedResult.type === "image" && onAnimateImage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-secondary border-secondary/30 hover:bg-secondary/10 text-xs gap-1.5"
                    onClick={() => { onAnimateImage(expandedResult.url); setExpandedId(null); }}
                  >
                    <Film className="w-3 h-3" />
                    Animate
                  </Button>
                )}
                {/* Move to folder in expanded view */}
                {onMoveToFolder && (
                  <div className="relative">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-primary border-primary/30 hover:bg-primary/10 text-xs gap-1.5"
                      onClick={() => setMoveMenuId(moveMenuId === expandedResult.id ? null : expandedResult.id)}
                    >
                      <FolderInput className="w-3 h-3" />
                      Move
                    </Button>
                    {moveMenuId === expandedResult.id && (
                      <MoveToFolderMenu
                        folders={folders}
                        currentFolderId={expandedResult.folderId}
                        onMove={(fid) => handleMove(expandedResult.id, fid)}
                        onClose={() => setMoveMenuId(null)}
                      />
                    )}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-cyan-400 border-cyan-400/30 hover:bg-cyan-400/10 text-xs gap-1.5"
                  onClick={() => handleShare(expandedResult)}
                  disabled={sharingId === expandedResult.id}
                >
                  {sharingId === expandedResult.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                  Share
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-secondary border-secondary/30 hover:bg-secondary/10 text-xs gap-1.5"
                  onClick={() => handleGrokkerPost(expandedResult)}
                  disabled={sharingId === expandedResult.id}
                >
                  <Sparkles className="w-3 h-3" />
                  Grokker
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-primary border-primary/30 hover:bg-primary/10 text-xs gap-1.5"
                  onClick={() => downloadMedia(expandedResult.url, expandedResult.type)}
                >
                  <Download className="w-3 h-3" />
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 text-xs gap-1.5"
                  onClick={() => confirmDelete(expandedResult.id)}
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </Button>
              </div>
              <div className="flex-1" />
              <Button
                size="icon"
                variant="ghost"
                className="text-foreground hover:text-primary"
                onClick={() => setExpandedId(null)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {expandedResult.type === "image" ? (
              <img
                src={expandedResult.url}
                alt={expandedResult.revised_prompt || "Generated image"}
                className="w-full h-auto max-h-[60vh] sm:max-h-[75vh] object-contain rounded border border-border"
              />
            ) : (
              <video
                src={expandedResult.url}
                className="w-full max-h-[60vh] sm:max-h-[75vh] rounded border border-border"
                controls
                autoPlay
                muted
                playsInline
                // @ts-ignore
                webkit-playsinline="true"
                preload="metadata"
              />
            )}

            {expandedResult.revised_prompt && (
              <div className="mt-2 sm:mt-3 p-3 bg-card border border-border rounded overflow-y-auto max-h-[25vh]">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="font-orbitron text-[10px] text-muted-foreground tracking-wider">
                    REVISED_PROMPT
                  </div>
                  <button
                    onClick={() => handleCopyPrompt(expandedResult.id, expandedResult.revised_prompt!)}
                    className="p-0.5 rounded hover:bg-primary/10 transition-colors"
                    title="Copy prompt"
                  >
                    {copiedId === expandedResult.id ? (
                      <Check className="w-3.5 h-3.5 text-primary" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-muted-foreground/40 hover:text-primary" />
                    )}
                  </button>
                </div>
                <p className="font-rajdhani text-sm text-foreground/80 leading-relaxed">
                  {expandedResult.revised_prompt}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsGrid;
