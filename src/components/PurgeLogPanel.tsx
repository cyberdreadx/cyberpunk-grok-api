/**
 * Admin → PURGES tab.
 * Shows recent media-purge runs (account deletes, library trash, admin
 * orphan-share sweeps) with how much was found vs. successfully deleted.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2, AlertTriangle, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface PurgeRow {
  id: number;
  run_at: string;
  kind: string;
  actor_email: string | null;
  target_email: string | null;
  blobs_found: number;
  blobs_deleted: number;
  r2_found: number;
  r2_deleted: number;
  errors: number;
  notes: any;
}

interface KindTotal {
  kind: string;
  runs: number;
  blobs_found: number;
  blobs_deleted: number;
  r2_found: number;
  r2_deleted: number;
  errors: number;
  last_run_at: string;
}

const KIND_LABELS: Record<string, string> = {
  "account-delete": "ACCOUNT_DELETE",
  "library-trash": "LIBRARY_TRASH",
  "admin-orphan-shares": "ADMIN_SHARES",
};

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function PurgeLogPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<PurgeRow[]>([]);
  const [totals, setTotals] = useState<KindTotal[]>([]);
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ rows: PurgeRow[]; totals: KindTotal[] }>("/admin", {
        method: "POST",
        body: { action: "purge-log", limit: 200, kind: kindFilter || undefined },
      });
      setRows(data.rows || []);
      setTotals(data.totals || []);
    } catch (err: any) {
      toast({ title: "Failed to load purge log", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [kindFilter, toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-2">
            <Trash2 className="w-3.5 h-3.5 text-secondary" />
            <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">
              MEDIA_PURGE_AUDIT · LAST_30_DAYS
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="font-mono-share text-xs gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            REFRESH
          </Button>
        </div>

        {/* Per-kind totals */}
        {totals.length === 0 ? (
          <p className="font-mono-share text-[11px] text-muted-foreground/60">No purge activity in the last 30 days.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {totals.map((t) => {
              const found = t.blobs_found + t.r2_found;
              const deleted = t.blobs_deleted + t.r2_deleted;
              const rate = found > 0 ? (deleted / found) * 100 : 100;
              const hasErrors = t.errors > 0;
              return (
                <button
                  key={t.kind}
                  onClick={() => setKindFilter(kindFilter === t.kind ? "" : t.kind)}
                  className={`text-left border rounded-md p-2.5 transition-colors ${
                    kindFilter === t.kind
                      ? "border-primary/60 bg-primary/5"
                      : "border-border/30 bg-background/40 hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-orbitron text-[10px] text-foreground tracking-wider">
                      {KIND_LABELS[t.kind] || t.kind.toUpperCase()}
                    </span>
                    {hasErrors && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                  </div>
                  <div className="mt-1.5 font-mono-share text-[10px] text-muted-foreground space-y-0.5">
                    <div>Runs: <span className="text-foreground">{t.runs}</span></div>
                    <div>
                      Deleted: <span className="text-foreground">{deleted}</span>
                      <span className="text-muted-foreground/60"> / {found}</span>
                      <span className="ml-1 text-primary/70">({rate.toFixed(0)}%)</span>
                    </div>
                    {hasErrors && (
                      <div className="text-amber-400">Errors: {t.errors}</div>
                    )}
                    <div className="text-muted-foreground/50">Last: {fmtDate(t.last_run_at)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {kindFilter && (
          <button
            onClick={() => setKindFilter("")}
            className="mt-3 font-mono-share text-[10px] text-primary/70 hover:text-primary"
          >
            ✕ CLEAR_FILTER ({KIND_LABELS[kindFilter] || kindFilter})
          </button>
        )}
      </section>

      {/* Detailed rows */}
      <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono-share">
            <thead className="bg-muted/20 text-muted-foreground/70">
              <tr>
                <th className="text-left px-3 py-2 font-normal">WHEN</th>
                <th className="text-left px-3 py-2 font-normal">KIND</th>
                <th className="text-left px-3 py-2 font-normal">ACTOR</th>
                <th className="text-left px-3 py-2 font-normal">TARGET</th>
                <th className="text-right px-3 py-2 font-normal">BLOB</th>
                <th className="text-right px-3 py-2 font-normal">R2</th>
                <th className="text-right px-3 py-2 font-normal">ERR</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground/60">
                    {loading ? "Loading..." : "No entries."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/20 hover:bg-muted/10">
                    <td className="px-3 py-2 text-muted-foreground/80 whitespace-nowrap">{fmtDate(r.run_at)}</td>
                    <td className="px-3 py-2">
                      <span className="text-foreground">{KIND_LABELS[r.kind] || r.kind}</span>
                      {r.notes?.dryRun && (
                        <span className="ml-1 text-amber-400/80 text-[9px]">[DRY]</span>
                      )}
                      {r.notes?.aborted && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-destructive text-[9px]">
                          <ShieldX className="w-2.5 h-2.5" />ABORTED
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground/70 truncate max-w-[180px]">{r.actor_email || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground/70 truncate max-w-[180px]">{r.target_email || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-foreground">{r.blobs_deleted}</span>
                      <span className="text-muted-foreground/50"> / {r.blobs_found}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-foreground">{r.r2_deleted}</span>
                      <span className="text-muted-foreground/50"> / {r.r2_found}</span>
                    </td>
                    <td className={`px-3 py-2 text-right ${r.errors > 0 ? "text-amber-400" : "text-muted-foreground/40"}`}>
                      {r.errors}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
