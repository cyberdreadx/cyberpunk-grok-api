/**
 * LegacySubReconcilePanel — admin tool to scan paid Stripe invoices on legacy
 * subscription prices (any price ID NOT in current STRIPE_PRICE_SUB_* env)
 * and grant the missing credits to the matched user.
 *
 * Backed by /api/admin/legacy-sub-reconcile (GET scan, POST apply).
 */

import { useState } from "react";
import { Loader2, Search, AlertTriangle, CheckCircle2, UserX, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiUrl, getAuthToken } from "@/lib/api";

interface ReconcileRow {
  invoiceId: string;
  customerId: string | null;
  customerEmail: string | null;
  amountPaidCents: number;
  priceIds: string[];
  owed: number;
  alreadyCredited: number;
  missing: number;
  userId: string | null;
  userEmail: string | null;
  createdAt: number;
  status: "ready" | "no_user" | "fully_credited";
}

interface Summary {
  total: number;
  ready: number;
  noUser: number;
  fullyCredited: number;
  missingCreditsTotal: number;
  currentPriceIds: string[];
  creditsPerDollar: number;
}

const fmtDate = (s: number) => new Date(s * 1000).toLocaleDateString();
const fmtMoney = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function LegacySubReconcilePanel() {
  const { toast } = useToast();
  const [since, setSince] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [limit, setLimit] = useState(200);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<ReconcileRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const auth = () => {
    const t = getAuthToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const scan = async () => {
    setScanning(true);
    setSelected(new Set());
    try {
      const r = await fetch(apiUrl(`/admin/legacy-sub-reconcile?since=${since}&limit=${limit}`), { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "scan failed");
      setRows(j.rows || []);
      setSummary(j.summary || null);
      // Auto-select all "ready" rows
      const ready = new Set<string>((j.rows || []).filter((x: ReconcileRow) => x.status === "ready").map((x: ReconcileRow) => x.invoiceId));
      setSelected(ready);
      toast({ title: "Scan complete", description: `${j.summary?.ready || 0} invoices ready, ${j.summary?.missingCreditsTotal || 0} credits missing.` });
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const apply = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Grant missing credits for ${selected.size} invoice(s)? This is idempotent.`)) return;
    setApplying(true);
    try {
      const r = await fetch("/api/admin/legacy-sub-reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth() },
        body: JSON.stringify({ invoiceIds: [...selected] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "apply failed");
      toast({
        title: "Credits granted",
        description: `Granted ${j.granted?.length || 0}, skipped ${j.skipped?.length || 0}.`,
      });
      await scan();
    } catch (e: any) {
      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectedCredits = rows
    .filter(r => selected.has(r.invoiceId) && r.status === "ready")
    .reduce((s, r) => s + r.missing, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <h3 className="font-orbitron text-[11px] tracking-wider text-amber-300">LEGACY SUBSCRIPTION RECONCILER</h3>
        </div>
        <p className="font-mono-share text-[10px] text-muted-foreground/80 leading-snug">
          Scans paid Stripe invoices on price IDs NOT in the current <code>STRIPE_PRICE_SUB_*</code> env map.
          For each, computes owed credits ({summary?.creditsPerDollar || 13}/$ fallback or
          <code> STRIPE_LEGACY_PRICE_CREDITS</code> override) and shows what's still missing in
          <code> transactions</code>. Apply grants the delta via <code>add_pack_credits</code>. Idempotent.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="font-mono-share text-[9px] uppercase text-muted-foreground/60">Since</label>
          <Input
            type="date"
            value={since}
            onChange={e => setSince(e.target.value)}
            className="h-8 w-40 font-mono-share text-[11px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono-share text-[9px] uppercase text-muted-foreground/60">Limit</label>
          <Input
            type="number"
            min={10}
            max={500}
            value={limit}
            onChange={e => setLimit(Math.min(500, parseInt(e.target.value) || 200))}
            className="h-8 w-24 font-mono-share text-[11px]"
          />
        </div>
        <Button onClick={scan} disabled={scanning} size="sm" variant="outline" className="font-orbitron text-[10px] gap-1.5">
          {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          SCAN
        </Button>
        <Button
          onClick={apply}
          disabled={applying || selected.size === 0}
          size="sm"
          className="font-orbitron text-[10px] gap-1.5 bg-green-600 hover:bg-green-500 text-white"
        >
          {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          GRANT {selectedCredits} CREDITS ({selected.size})
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Total scanned" value={summary.total} />
          <Stat label="Ready to grant" value={summary.ready} accent="text-green-400" />
          <Stat label="No user found" value={summary.noUser} accent="text-amber-400" />
          <Stat label="Missing credits" value={summary.missingCreditsTotal} accent="text-primary" />
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full font-mono-share text-[10px]">
              <thead className="bg-card/40 border-b border-border/30">
                <tr className="text-left text-muted-foreground/60">
                  <th className="px-2 py-1.5 w-8"></th>
                  <th className="px-2 py-1.5">Invoice</th>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Paid</th>
                  <th className="px-2 py-1.5">Owed</th>
                  <th className="px-2 py-1.5">Already</th>
                  <th className="px-2 py-1.5">Missing</th>
                  <th className="px-2 py-1.5">User</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.invoiceId} className="border-b border-border/10 hover:bg-card/20">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        disabled={r.status !== "ready"}
                        checked={selected.has(r.invoiceId)}
                        onChange={() => toggle(r.invoiceId)}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[9px] text-muted-foreground">{r.invoiceId.slice(0, 14)}…</td>
                    <td className="px-2 py-1.5">{fmtDate(r.createdAt)}</td>
                    <td className="px-2 py-1.5">{fmtMoney(r.amountPaidCents)}</td>
                    <td className="px-2 py-1.5">{r.owed}</td>
                    <td className="px-2 py-1.5 text-muted-foreground/60">{r.alreadyCredited}</td>
                    <td className={`px-2 py-1.5 font-bold ${r.missing > 0 ? "text-primary" : "text-muted-foreground/40"}`}>{r.missing}</td>
                    <td className="px-2 py-1.5">
                      {r.userEmail ? (
                        <span className={r.userId ? "text-foreground" : "text-amber-400"}>{r.userEmail}</span>
                      ) : (
                        <span className="text-muted-foreground/40">{r.customerId?.slice(0, 12) || "?"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.status === "ready" && <span className="text-green-400">READY</span>}
                      {r.status === "no_user" && <span className="text-amber-400 inline-flex items-center gap-1"><UserX className="w-2.5 h-2.5" />NO USER</span>}
                      {r.status === "fully_credited" && <span className="text-muted-foreground/40 inline-flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" />DONE</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!scanning && rows.length === 0 && summary && (
        <div className="rounded-lg border border-border/30 bg-card/20 p-6 text-center">
          <RefreshCw className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40" />
          <p className="font-mono-share text-[11px] text-muted-foreground/60">No legacy invoices found in this range.</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-md border border-border/30 bg-card/30 px-3 py-2">
      <div className="font-mono-share text-[8px] uppercase tracking-wider text-muted-foreground/50">{label}</div>
      <div className={`font-orbitron text-base ${accent || "text-foreground"}`}>{value.toLocaleString()}</div>
    </div>
  );
}
