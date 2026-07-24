/**
 * Admin-only panel shown on another user's ProfilePage.
 * Lets admins inspect credits + purchase history and grant credits inline.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Plus, ShieldAlert, ShieldCheck, Coins, Receipt, Ban, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Tx {
  id: string | number;
  credits: number;
  amount_cents: number;
  package: string | null;
  type: string | null;
  payment_method: string | null;
  stripe_session_id: string | null;
  created_at: string;
}

interface InspectResp {
  user: {
    id: string;
    email: string;
    subscription_tier: string | null;
    sub_credits: number;
    pack_credits: number;
    daily_credits: number;
    verification_status?: string | null;
  };
  transactions: Tx[];
  totalSpentCents: number;
  totalPurchases: number;
  ban: { reason: string; created_at: string; expires_at: string | null } | null;
  moderationFlags: number;
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AdminUserPanel({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<InspectResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [grantAmount, setGrantAmount] = useState("");
  const [grantType, setGrantType] = useState<"pack" | "sub">("pack");
  const [granting, setGranting] = useState(false);
  const [zeroing, setZeroing] = useState(false);
  const [unbanning, setUnbanning] = useState(false);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiFetch<InspectResp>("/admin", {
        method: "POST",
        body: { action: "user-inspect", userId },
      });
      setData(resp);
    } catch (err: any) {
      toast({ title: "Inspect failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => { load(); }, [load]);

  const handleGrant = async () => {
    const amt = parseInt(grantAmount, 10);
    if (!amt || amt < 1 || amt > 50000) {
      toast({ title: "Enter 1–50000 credits", variant: "destructive" });
      return;
    }
    if (!data?.user.email) return;
    setGranting(true);
    try {
      await apiFetch("/admin", {
        method: "POST",
        body: { action: "grant-credits", email: data.user.email, credits: amt, type: grantType },
      });
      toast({ title: `Granted ${amt} ${grantType} credits` });
      setGrantAmount("");
      load();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setGranting(false);
    }
  };

  const handleUnban = async () => {
    if (!data?.user.email) return;
    if (!window.confirm(`Unban ${data.user.email}?`)) return;
    setUnbanning(true);
    try {
      await apiFetch("/admin", {
        method: "POST",
        body: { action: "unban-user", userId },
      });
      toast({ title: `Unbanned ${data.user.email}` });
      load();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setUnbanning(false);
    }
  };

  const handlePurgeStorage = async () => {
    if (!data?.user.email) return;
    if (!window.confirm(
      `Purge ALL cloud media for ${data.user.email}?\n\nDeletes every generation output, upload, avatar etc. from R2 + Blob storage. Their library items that reference remote copies will stop loading. Cannot be undone.`,
    )) return;
    setPurging(true);
    try {
      const resp = await apiFetch<{ r2Deleted: number; blobDeleted: number }>("/admin", {
        method: "POST",
        body: { action: "purge-user-storage", email: data.user.email },
      });
      toast({ title: `Purged ${resp.r2Deleted + resp.blobDeleted} stored objects` });
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setPurging(false);
    }
  };

  const handleZero = async () => {
    if (!data?.user.email) return;
    const total = (data.user.pack_credits || 0) + (data.user.sub_credits || 0) + (data.user.daily_credits || 0);
    if (!window.confirm(`Zero ALL credits for ${data.user.email}? (${total} credits will be wiped)`)) return;
    setZeroing(true);
    try {
      const resp = await apiFetch<{ wiped: number }>("/admin", {
        method: "POST",
        body: { action: "zero-credits", email: data.user.email },
      });
      toast({ title: `Wiped ${resp.wiped} credits` });
      load();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setZeroing(false);
    }
  };

  return (
    <div className="border border-primary/30 rounded-lg bg-card/60 backdrop-blur-sm p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 text-primary" />
          <span className="font-orbitron text-[10px] tracking-widest text-primary">ADMIN_INSPECTOR</span>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="font-mono-share text-[10px] gap-1.5 h-7">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          REFRESH
        </Button>
      </div>

      {!data ? (
        <p className="font-mono-share text-[11px] text-muted-foreground/60">{loading ? "Loading…" : "No data."}</p>
      ) : (
        <>
          {/* Email + tier */}
          <div className="font-mono-share text-[11px] text-muted-foreground space-y-0.5">
            <div>EMAIL: <span className="text-foreground">{data.user.email}</span></div>
            <div>
              TIER: <span className="text-foreground">{data.user.subscription_tier || "free"}</span>
              {data.user.verification_status && (
                <span className="ml-3">VERIFIED: <span className="text-foreground">{data.user.verification_status}</span></span>
              )}
            </div>
            {data.ban && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-destructive">BANNED: {data.ban.reason} {data.ban.expires_at ? `(until ${fmtDate(data.ban.expires_at)})` : "(permanent)"}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUnban}
                  disabled={unbanning}
                  className="font-mono-share text-[9px] h-6 px-2 gap-1 border-green-500/40 text-green-400 hover:bg-green-500/10"
                >
                  {unbanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                  UNBAN
                </Button>
              </div>
            )}
          </div>

          {/* Credits */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "PACK", value: data.user.pack_credits },
              { label: "SUB", value: data.user.sub_credits },
              { label: "DAILY", value: data.user.daily_credits },
            ].map((c) => (
              <div key={c.label} className="border border-border/30 rounded-md p-2 text-center">
                <div className="font-orbitron text-base text-foreground flex items-center justify-center gap-1">
                  <Coins className="w-3 h-3 text-primary/60" />
                  {c.value ?? 0}
                </div>
                <div className="font-mono-share text-[9px] text-muted-foreground">{c.label}</div>
              </div>
            ))}
          </div>

          {/* Spend */}
          <div className="font-mono-share text-[11px] text-muted-foreground border-t border-border/30 pt-2">
            LIFETIME: <span className="text-foreground">{fmtUsd(data.totalSpentCents)}</span>
            <span className="ml-3">PURCHASES: <span className="text-foreground">{data.totalPurchases}</span></span>
          </div>

          {/* Grant credits */}
          <div className="border-t border-border/30 pt-3 space-y-2">
            <div className="font-mono-share text-[10px] text-muted-foreground tracking-wider">GRANT_CREDITS</div>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={50000}
                placeholder="Amount"
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                className="h-8 font-mono-share text-xs bg-input/50 flex-1"
              />
              <select
                value={grantType}
                onChange={(e) => setGrantType(e.target.value as "pack" | "sub")}
                className="h-8 px-2 rounded-md border border-border/40 bg-input/50 font-mono-share text-xs"
              >
                <option value="pack">PACK</option>
                <option value="sub">SUB</option>
              </select>
              <Button size="sm" onClick={handleGrant} disabled={granting || !grantAmount} className="font-mono-share text-[10px] h-8 gap-1">
                {granting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                GRANT
              </Button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleZero}
              disabled={zeroing}
              className="font-mono-share text-[10px] h-8 gap-1 w-full"
            >
              {zeroing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
              ZERO_ALL_CREDITS
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePurgeStorage}
              disabled={purging}
              className="font-mono-share text-[10px] h-8 gap-1 w-full border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              {purging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              PURGE_CLOUD_MEDIA
            </Button>
          </div>

          {/* Purchase history */}
          <div className="border-t border-border/30 pt-3 space-y-2">
            <div className="flex items-center gap-1.5 font-mono-share text-[10px] text-muted-foreground tracking-wider">
              <Receipt className="w-3 h-3" /> PURCHASE_HISTORY ({data.transactions.length})
            </div>
            {data.transactions.length === 0 ? (
              <p className="font-mono-share text-[10px] text-muted-foreground/60">No transactions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono-share">
                  <thead className="text-muted-foreground/70">
                    <tr>
                      <th className="text-left py-1 pr-2 font-normal">WHEN</th>
                      <th className="text-left py-1 pr-2 font-normal">PKG</th>
                      <th className="text-left py-1 pr-2 font-normal">TYPE</th>
                      <th className="text-right py-1 pr-2 font-normal">CR</th>
                      <th className="text-right py-1 font-normal">USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((t) => (
                      <tr key={String(t.id)} className="border-t border-border/20">
                        <td className="py-1 pr-2 text-muted-foreground/80 whitespace-nowrap">{fmtDate(t.created_at)}</td>
                        <td className="py-1 pr-2 text-foreground truncate max-w-[120px]">{t.package || "—"}</td>
                        <td className="py-1 pr-2 text-muted-foreground">{t.type || t.payment_method || "—"}</td>
                        <td className="py-1 pr-2 text-right text-foreground">{t.credits || 0}</td>
                        <td className="py-1 text-right text-foreground">{fmtUsd(t.amount_cents || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
