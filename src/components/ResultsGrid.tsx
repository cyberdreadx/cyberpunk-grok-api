import React, { useState, useCallback, useRef, useEffect } from "react";
import { Download, Maximize2, X, Trash2, ExternalLink, ChevronLeft, ChevronRight, Pencil, Film, Copy, Check, FolderPlus, FolderOpen, MoreVertical, FolderInput, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GrokResult } from "@/hooks/useGrokApi";
import type { Folder } from "@/lib/storage";
import type { FolderFilter } from "@/hooks/useFolders";
import { useSwipe } from "@/hooks/useSwipe";

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
  onMoveToFolder?: (resultId: string, folderId: string | null) => Promise<any>;
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
 * Works with both Netlify Functions and Vercel API routes.
 */
function getProxyDownloadUrl(url: string, filename: string): string {
  const apiUrl = import.meta.env.VITE_API_URL as string;
  const base = apiUrl
    ? `${apiUrl}/download`
    : "/.netlify/functions/download";
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
  resultCounts,
  unlockedFolders,
  onRequestUnlock,
  onSetPin,
  onRemovePin,
}: {
  folders: Folder[];
  selectedFilter: FolderFilter;
  onSelectFilter: (filter: FolderFilter) => void;
  onCreateFolder: (name: string) => Promise<any>;
  onRenameFolder?: (id: string, name: string) => Promise<void>;
  onDeleteFolder?: (id: string) => Promise<void>;
  resultCounts: Record<string, number>;
  unlockedFolders: Set<string>;
  onRequestUnlock: (folderId: string) => void;
  onSetPin: (folderId: string) => void;
  onRemovePin: (folderId: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) createInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const handleCreate = async () => {
    const name = newFolderName.trim();
    if (!name) { setIsCreating(false); return; }
    try {
      await onCreateFolder(name);
      setNewFolderName("");
      setIsCreating(false);
    } catch (err: any) {
      console.error("[FolderBar] Create failed:", err.message);
    }
  };

  const handleRename = async (id: string) => {
    const name = editingName.trim();
    if (!name || !onRenameFolder) { setEditingId(null); return; }
    try {
      await onRenameFolder(id, name);
    } catch (err: any) {
      console.error("[FolderBar] Rename failed:", err.message);
    }
    setEditingId(null);
  };

  const tabClass = (active: boolean) =>
    `px-2.5 py-1.5 text-[9px] sm:text-[10px] font-mono-share tracking-wider whitespace-nowrap transition-colors rounded-t border-b-2 ${
      active
        ? "border-primary text-primary bg-primary/10"
        : "border-transparent text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30"
    }`;

  // Built-in tabs (UNFILED, ALL) with Radix DropdownMenu - reliable, no custom event handling
  const renderBuiltInTab = (id: string, label: string, countKey: string) => {
    const pinId = `__${id}`;
    const hasPin = folderHasPin(pinId);
    const isUnlocked = unlockedFolders.has(pinId);
    const isLocked = hasPin && !isUnlocked;

    return (
      <div key={pinId} className="relative flex items-center">
        <button
          className={tabClass(selectedFilter === id)}
          onClick={() => {
            if (isLocked) {
              onRequestUnlock(pinId);
            } else {
              onSelectFilter(id);
            }
          }}
        >
          {hasPin && (
            isLocked
              ? <Lock className="w-3 h-3 inline-block mr-1 -mt-0.5 text-secondary" />
              : <LockOpen className="w-3 h-3 inline-block mr-1 -mt-0.5 text-primary/50" />
          )}
          {label}
          <span className="ml-1 text-muted-foreground/40">
            {isLocked ? "***" : (resultCounts[countKey] ?? 0)}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-0.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors">
              <MoreVertical className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px] bg-card border-border">
            {hasPin ? (
              <DropdownMenuItem
                className="text-[10px] font-mono-share text-secondary focus:bg-secondary/10 cursor-pointer"
                onSelect={() => onRemovePin(pinId)}
              >
                <LockOpen className="w-3 h-3 mr-1.5" />
                REMOVE PIN
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="text-[10px] font-mono-share text-primary focus:bg-primary/10 cursor-pointer"
                onSelect={() => onSetPin(pinId)}
              >
                <Lock className="w-3 h-3 mr-1.5" />
                SET PIN
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide pb-px border-b border-border/50 -mb-px">
      {/* UNFILED tab (first) */}
      {renderBuiltInTab("unfiled", "UNFILED", "__unfiled")}

      {/* Custom folder tabs */}
      {folders.map((folder) => {
        const hasPin = folderHasPin(folder.id);
        const isUnlocked = unlockedFolders.has(folder.id);
        const isLocked = hasPin && !isUnlocked;

        return (
        <div key={folder.id} className="relative flex items-center">
          {editingId === folder.id ? (
            <input
              ref={editInputRef}
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => handleRename(folder.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(folder.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              className="bg-input border border-primary/50 rounded px-1.5 py-1 text-[9px] sm:text-[10px] font-mono-share w-20 outline-none text-primary"
            />
          ) : (
            <button
              className={tabClass(selectedFilter === folder.id)}
              onClick={() => {
                if (isLocked) {
                  onRequestUnlock(folder.id);
                } else {
                  onSelectFilter(folder.id);
                }
              }}
              onDoubleClick={() => {
                if (!isLocked) {
                  setEditingId(folder.id);
                  setEditingName(folder.name);
                }
              }}
            >
              {hasPin && (
                isLocked
                  ? <Lock className="w-3 h-3 inline-block mr-1 -mt-0.5 text-secondary" />
                  : <LockOpen className="w-3 h-3 inline-block mr-1 -mt-0.5 text-primary/50" />
              )}
              {!hasPin && <FolderOpen className="w-3 h-3 inline-block mr-1 -mt-0.5" />}
              {folder.name.toUpperCase()}
              <span className="ml-1 text-muted-foreground/40">
                {isLocked ? "***" : (resultCounts[folder.id] ?? 0)}
              </span>
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-0.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                <MoreVertical className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[120px] bg-card border-border">
              <DropdownMenuItem
                className="text-[10px] font-mono-share cursor-pointer"
                onSelect={() => {
                  setEditingId(folder.id);
                  setEditingName(folder.name);
                }}
              >
                RENAME
              </DropdownMenuItem>
              {hasPin ? (
                <DropdownMenuItem
                  className="text-[10px] font-mono-share text-secondary focus:bg-secondary/10 cursor-pointer"
                  onSelect={() => onRemovePin(folder.id)}
                >
                  <LockOpen className="w-3 h-3 mr-1.5" />
                  REMOVE PIN
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="text-[10px] font-mono-share text-primary focus:bg-primary/10 cursor-pointer"
                  onSelect={() => onSetPin(folder.id)}
                >
                  <Lock className="w-3 h-3 mr-1.5" />
                  SET PIN
                </DropdownMenuItem>
              )}
              {onDeleteFolder && (
                <DropdownMenuItem
                  className="text-[10px] font-mono-share text-destructive focus:bg-destructive/10 cursor-pointer"
                  onSelect={() => onDeleteFolder(folder.id)}
                >
                  DELETE
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        );
      })}

      {/* ALL tab (last) */}
      {renderBuiltInTab("all", "ALL", "__total")}

      {/* Create folder button / input */}
      {isCreating ? (
        <input
          ref={createInputRef}
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onBlur={handleCreate}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") { setIsCreating(false); setNewFolderName(""); }
          }}
          placeholder="folder name..."
          className="bg-input border border-primary/50 rounded px-1.5 py-1 text-[9px] sm:text-[10px] font-mono-share w-24 outline-none text-primary placeholder:text-muted-foreground/30"
        />
      ) : (
        <button
          className="px-2 py-1.5 text-muted-foreground/40 hover:text-primary transition-colors"
          onClick={() => setIsCreating(true)}
          title="Create folder"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
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

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full mt-1 z-[60] bg-card border border-border rounded shadow-lg py-1 min-w-[140px]"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-[9px] font-orbitron tracking-wider text-muted-foreground/50 border-b border-border/50 mb-1">
        MOVE_TO
      </div>

      {/* Unfiled option */}
      <button
        className={`w-full text-left px-3 py-1.5 text-[10px] font-mono-share transition-colors flex items-center gap-1.5 ${
          !currentFolderId
            ? "text-primary bg-primary/10"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
        onClick={() => { onMove(null); onClose(); }}
      >
        UNFILED
      </button>

      {/* Folder options */}
      {folders.map((folder) => (
        <button
          key={folder.id}
          className={`w-full text-left px-3 py-1.5 text-[10px] font-mono-share transition-colors flex items-center gap-1.5 ${
            currentFolderId === folder.id
              ? "text-primary bg-primary/10"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
          onClick={() => { onMove(folder.id); onClose(); }}
        >
          <FolderOpen className="w-3 h-3" />
          {folder.name.toUpperCase()}
        </button>
      ))}

      {folders.length === 0 && (
        <div className="px-3 py-1.5 text-[10px] font-mono-share text-muted-foreground/40">
          No folders yet
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

const ResultsGrid: React.FC<ResultsGridProps> = ({
  results,
  isLoading,
  elapsedSeconds = 0,
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
  onMoveToFolder,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mobileIndex, setMobileIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null);

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

  // Filter results based on selected folder
  const filteredResults = React.useMemo(() => {
    if (selectedFilter === "none") return [];
    if (selectedFilter === "all") return results;
    if (selectedFilter === "unfiled") return results.filter((r) => !r.folderId);
    return results.filter((r) => r.folderId === selectedFilter);
  }, [results, selectedFilter]);

  // Compute result counts per folder for badges
  const resultCounts = React.useMemo(() => {
    const counts: Record<string, number> = {
      __total: results.length,
      __unfiled: results.filter((r) => !r.folderId).length,
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
            resultCounts={resultCounts}
            unlockedFolders={unlockedFolders}
            onRequestUnlock={handleRequestUnlock}
            onSetPin={handleSetPin}
            onRemovePin={handleRemovePin}
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
      {/* Folder bar */}
      {hasFolders && onSelectFilter && onCreateFolder && (
        <FolderBar
          folders={folders}
          selectedFilter={selectedFilter}
          onSelectFilter={onSelectFilter}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          resultCounts={resultCounts}
          unlockedFolders={unlockedFolders}
          onRequestUnlock={handleRequestUnlock}
          onSetPin={handleSetPin}
          onRemovePin={handleRemovePin}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="font-orbitron text-xs tracking-wider text-muted-foreground">
          OUTPUT [{filteredResults.length}]
        </div>
        {filteredResults.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-destructive hover:text-destructive/80 font-mono-share text-xs"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            PURGE
          </Button>
        )}
      </div>

      {/* Loading skeleton with elapsed timer */}
      {isLoading && (
        <div className="border border-primary/30 rounded p-1 animate-pulse-glow">
          <div className="aspect-square bg-muted rounded flex flex-col items-center justify-center gap-2">
            <div className="font-mono-share text-xs text-primary animate-flicker">
              RENDERING...
            </div>
            {elapsedSeconds > 0 && (
              <div className="font-mono-share text-[10px] text-muted-foreground tabular-nums">
                {Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")}:{(elapsedSeconds % 60).toString().padStart(2, "0")}
              </div>
            )}
            {elapsedSeconds > 0 && (
              <div className="w-32 h-0.5 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary/60 rounded-full animate-pulse" style={{ width: "100%" }} />
              </div>
            )}
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
                preload="auto"
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
              {currentResult?.type.toUpperCase()}
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

          {/* Mobile action bar */}
          <div className="flex items-center justify-between px-2 py-1.5 border border-t-0 border-border/30 rounded-b flex-wrap gap-1">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="text-primary text-xs gap-1 h-7 px-2"
                onClick={() => currentResult && setExpandedId(currentResult.id)}
              >
                <Maximize2 className="w-3 h-3" />
                View
              </Button>
              {currentResult && <ImageActions result={currentResult} size="sm" />}
            </div>
            <div className="flex gap-1">
              {/* Move to folder button (mobile) */}
              {onMoveToFolder && currentResult && (
                <div className="relative">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-primary h-7 w-7"
                    onClick={() => setMoveMenuId(moveMenuId === currentResult.id ? null : currentResult.id)}
                    title="Move to folder"
                  >
                    <FolderInput className="w-3 h-3" />
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
                className="text-primary h-7 w-7"
                onClick={() => currentResult && downloadMedia(currentResult.url, currentResult.type)}
                title="Download / Save"
              >
                <Download className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="text-primary h-7 w-7" asChild>
                <a href={currentResult?.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3 h-3" />
                </a>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:bg-destructive/20 h-7 w-7"
                onClick={() => currentResult && onDelete(currentResult.id)}
                title="Delete this item"
              >
                <Trash2 className="w-3 h-3" />
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
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === clampedIndex
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
            className="group relative border border-border rounded overflow-hidden bg-card hover:border-primary/50 transition-all animate-slide-up"
            style={{ animationDelay: `${idx * 50}ms` }}
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
                controls
                muted
                playsInline
                preload="auto"
              />
            )}

            {/* Overlay — desktop hover (stays visible when move menu is open) */}
            <div className={`absolute inset-0 bg-background/80 transition-opacity flex items-center justify-center gap-2 ${
              moveMenuId === result.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
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
                onClick={() => onDelete(result.id)}
                title="Delete this item"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            {/* Type badge */}
            <div className="absolute top-2 left-2 font-mono-share text-[9px] bg-background/80 text-primary px-1.5 py-0.5 rounded">
              {result.type.toUpperCase()}
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
                  onClick={() => { onDelete(expandedResult.id); setExpandedId(null); }}
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
                playsInline
                preload="auto"
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
