/**
 * Lists every active /s/:id share link the signed-in user owns (server-side
 * truth from share_owners, so it covers links minted on other browsers and
 * devices) and lets them revoke each one — or all at once.
 */
import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, Trash2, ExternalLink, RefreshCw, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { forgetShareLinks } from "@/lib/shareLinks";

interface ShareRow {
  shareId: string;
  shareUrl: string;
  mediaType: "image" | "video";
  createdAt: string | null;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return "—"; }
}

export default function ShareLinksManager({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [shares, setShares] = useState<ShareRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiFetch<{ shares: ShareRow[] }>("/share?action=mine");
      setShares(resp.shares);
    } catch (err: any) {
      toast.error(err.message || "Failed to load share links");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const revokeOne = useCallback(async (shareId: string) => {
    setRevoking(shareId);
    try {
      await apiFetch(`/share?id=${encodeURIComponent(shareId)}`, { method: "DELETE" });
      setShares((prev) => prev?.filter((s) => s.shareId !== shareId) ?? null);
      toast.success("Share link revoked — the page and file are gone");
    } catch (err: any) {
      toast.error(err.message || "Failed to revoke");
    } finally {
      setRevoking(null);
    }
  }, []);

  const revokeAll = useCallback(async () => {
    if (!shares?.length) return;
    if (!window.confirm(`Revoke ALL ${shares.length} share links? Every /s/ page you've created will stop working.`)) return;
    setRevoking("all");
    try {
      const resp = await apiFetch<{ deleted: number }>(`/share?id=all`, { method: "DELETE" });
      forgetShareLinks();
      setShares([]);
      toast.success(`Revoked ${resp.deleted} share links`);
    } catch (err: any) {
      toast.error(err.message || "Failed to revoke all");
    } finally {
      setRevoking(null);
    }
  }, [shares]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-orbitron text-sm tracking-widest text-primary flex items-center gap-2">
            <Link2 className="w-4 h-4" /> ACTIVE_SHARE_LINKS
          </DialogTitle>
        </DialogHeader>

        <p className="font-mono-share text-[10px] text-muted-foreground">
          Every public /s/ link you've created, on any device. Revoking one
          permanently deletes the page and its media file from our servers.
        </p>

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="font-mono-share text-[10px] h-7 gap-1.5">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            REFRESH
          </Button>
          {!!shares?.length && (
            <Button
              variant="destructive"
              size="sm"
              onClick={revokeAll}
              disabled={revoking !== null}
              className="font-mono-share text-[10px] h-7 gap-1.5"
            >
              {revoking === "all" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              REVOKE ALL ({shares.length})
            </Button>
          )}
        </div>

        {shares === null ? (
          <p className="font-mono-share text-[11px] text-muted-foreground/60 py-4 text-center">
            {loading ? "Loading…" : "Could not load."}
          </p>
        ) : shares.length === 0 ? (
          <p className="font-mono-share text-[11px] text-muted-foreground/60 py-4 text-center">
            No active share links. 🎉
          </p>
        ) : (
          <div className="space-y-1.5">
            {shares.map((s) => (
              <div key={s.shareId} className="flex items-center gap-2 border border-border/30 rounded-md px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="font-mono-share text-[11px] text-foreground truncate">/s/{s.shareId}</div>
                  <div className="font-mono-share text-[9px] text-muted-foreground">
                    {s.mediaType.toUpperCase()} · {fmtDate(s.createdAt)}
                  </div>
                </div>
                <button
                  onClick={() => { navigator.clipboard?.writeText(s.shareUrl); toast.success("Copied"); }}
                  className="p-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
                  title="Copy link"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <a
                  href={s.shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
                  title="Open"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revokeOne(s.shareId)}
                  disabled={revoking !== null}
                  className="h-7 px-2 text-destructive hover:bg-destructive/10 font-mono-share text-[9px] gap-1"
                >
                  {revoking === s.shareId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  REVOKE
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
