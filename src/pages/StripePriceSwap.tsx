import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const KNOWN_ENV_KEYS = [
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_MEGA",
  "STRIPE_PRICE_ULTRA",
  "STRIPE_PRICE_ENTERPRISE",
  "STRIPE_PRICE_SUB_BASIC",
  "STRIPE_PRICE_SUB_PREMIUM",
  "STRIPE_PRICE_SUB_PRO",
  "STRIPE_PRICE_SUB_ELITE",
  "STRIPE_PRICE_SUB_BASIC_YEARLY",
  "STRIPE_PRICE_SUB_PREMIUM_YEARLY",
  "STRIPE_PRICE_SUB_PRO_YEARLY",
  "STRIPE_PRICE_SUB_ELITE_YEARLY",
];

const SUB_KEYS = new Set(KNOWN_ENV_KEYS.filter((k) => k.includes("SUB_")));

type PriceInfo = {
  id: string;
  active?: boolean;
  livemode?: boolean;
  currency?: string;
  unit_amount?: number | null;
  recurring?: { interval: string; interval_count: number } | null;
  product?: { id: string; name: string } | null;
  error?: string;
};

type CurrentMap = Record<string, { value: string | null; info: PriceInfo | null }>;

const DRAFT_KEY = "gltch:stripe-price-draft";

function fmt(p: PriceInfo | null | undefined) {
  if (!p) return "—";
  if (p.error) return `ERR: ${p.error}`;
  const amt = typeof p.unit_amount === "number" ? `$${(p.unit_amount / 100).toFixed(2)} ${p.currency?.toUpperCase()}` : "—";
  const rec = p.recurring ? ` / ${p.recurring.interval_count > 1 ? p.recurring.interval_count + " " : ""}${p.recurring.interval}` : "";
  const live = p.livemode ? "LIVE" : "TEST";
  return `${amt}${rec}  ·  ${p.product?.name || "?"}  ·  ${live}${p.active === false ? " · ARCHIVED" : ""}`;
}

function diffClass(curr: PriceInfo | null | undefined, next: PriceInfo | null | undefined) {
  if (!curr || !next) return "";
  if (curr.error || next.error) return "text-red-400";
  if (curr.unit_amount !== next.unit_amount || curr.currency !== next.currency) return "text-yellow-300";
  if ((curr.recurring?.interval || null) !== (next.recurring?.interval || null)) return "text-yellow-300";
  if (curr.livemode !== next.livemode) return "text-magenta-400 text-fuchsia-400";
  return "text-green-400";
}

export default function StripePriceSwap() {
  const [me, setMe] = useState<{ is_admin?: boolean; email?: string } | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [current, setCurrent] = useState<CurrentMap>({});
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    try {
      const v = localStorage.getItem(DRAFT_KEY);
      return v ? JSON.parse(v) : {};
    } catch {
      return {};
    }
  });
  const [previews, setPreviews] = useState<Record<string, PriceInfo>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = useMemo(
    () => localStorage.getItem("auth-token") || localStorage.getItem("gltch:jwt") || localStorage.getItem("jwt") || "",
    [],
  );

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json();
        setMe(j);
      } catch {
        setMe(null);
      } finally {
        setMeLoading(false);
      }
    })();
  }, [token]);

  const loadCurrent = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/stripe-price-inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "current" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setCurrent(j.current || {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (me?.is_admin) loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.is_admin]);

  const inspectDraft = async () => {
    const ids = Object.values(draft).map((v) => v.trim()).filter(Boolean);
    if (ids.length === 0) {
      setPreviews({});
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/stripe-price-inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "inspect", priceIds: ids }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      const map: Record<string, PriceInfo> = {};
      (j.results as PriceInfo[]).forEach((p) => (map[p.id] = p));
      setPreviews(map);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const testCheckout = async (key: string, priceId: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/stripe-price-inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "test-checkout",
          priceId,
          mode: SUB_KEYS.has(key) ? "subscription" : "payment",
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      window.open(j.url, "_blank");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const envExport = useMemo(() => {
    const lines: string[] = [];
    KNOWN_ENV_KEYS.forEach((k) => {
      const v = (draft[k] || "").trim();
      if (v) lines.push(`${k}=${v}`);
    });
    return lines.join("\n");
  }, [draft]);

  if (meLoading) {
    return <div className="min-h-screen bg-background text-foreground p-8 font-mono text-sm">Loading…</div>;
  }

  if (!me?.is_admin) {
    return (
      <div className="min-h-screen bg-background text-foreground p-8 font-mono text-sm">
        <p className="text-red-400">403 — admin only</p>
        <Link to="/" className="underline text-cyan-400">← back</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-mono p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="border border-border rounded p-4 bg-card/50">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h1 className="text-xl text-cyan-400">▌ stripe price swap</h1>
            <Link to="/admin" className="text-xs underline text-muted-foreground hover:text-foreground">← admin</Link>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Paste new <code className="text-fuchsia-400">price_xxx</code> IDs, preview the diff against the live env, and test
            a real checkout — all before redeploying with the new env vars.
          </p>
        </header>

        {error && (
          <div className="border border-red-500/50 bg-red-500/10 text-red-300 rounded p-3 text-xs">{error}</div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={loadCurrent}
            disabled={busy}
            className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent disabled:opacity-50"
          >
            ↻ refresh current
          </button>
          <button
            onClick={inspectDraft}
            disabled={busy}
            className="px-3 py-1.5 text-xs border border-cyan-500/50 text-cyan-400 rounded hover:bg-cyan-500/10 disabled:opacity-50"
          >
            ▶ preview draft
          </button>
          <button
            onClick={() => {
              if (confirm("Clear all draft IDs?")) setDraft({});
            }}
            className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent"
          >
            ✕ clear draft
          </button>
        </div>

        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="text-left p-2 font-normal">env key</th>
                <th className="text-left p-2 font-normal">current</th>
                <th className="text-left p-2 font-normal">new price id</th>
                <th className="text-left p-2 font-normal">preview</th>
                <th className="text-left p-2 font-normal w-24">action</th>
              </tr>
            </thead>
            <tbody>
              {KNOWN_ENV_KEYS.map((k) => {
                const cur = current[k];
                const draftVal = draft[k] || "";
                const newPreview = draftVal ? previews[draftVal.trim()] : undefined;
                const cls = newPreview ? diffClass(cur?.info, newPreview) : "";
                return (
                  <tr key={k} className="border-t border-border align-top">
                    <td className="p-2 text-fuchsia-400 whitespace-nowrap">{k}</td>
                    <td className="p-2">
                      <div className="text-muted-foreground truncate max-w-[200px]" title={cur?.value || ""}>
                        {cur?.value || <span className="text-red-400">unset</span>}
                      </div>
                      <div className="text-[11px] mt-0.5">{fmt(cur?.info)}</div>
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={draftVal}
                        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                        placeholder="price_..."
                        className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:border-cyan-500 outline-none"
                      />
                    </td>
                    <td className={`p-2 text-[11px] ${cls}`}>
                      {newPreview ? fmt(newPreview) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2">
                      {draftVal && newPreview && !newPreview.error && (
                        <button
                          onClick={() => testCheckout(k, draftVal.trim())}
                          disabled={busy}
                          className="px-2 py-1 text-[11px] border border-green-500/50 text-green-400 rounded hover:bg-green-500/10 disabled:opacity-50"
                        >
                          test ↗
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {envExport && (
          <div className="border border-border rounded p-4 bg-card/50 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-cyan-400 text-sm">▌ env export (paste into Vercel)</h2>
              <button
                onClick={() => navigator.clipboard.writeText(envExport)}
                className="px-2 py-1 text-[11px] border border-border rounded hover:bg-accent"
              >
                copy
              </button>
            </div>
            <pre className="text-[11px] bg-background border border-border rounded p-3 overflow-x-auto whitespace-pre">
{envExport}
            </pre>
            <p className="text-[11px] text-muted-foreground">
              Note: existing subscribers stay on their old price until they cancel/resubscribe.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
