import React, { useState, useEffect, useCallback } from "react";
import { Key, Copy, Trash2, Plus, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  rate_limit: number;
  total_requests: number;
  total_credits: number;
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
}

export default function ApiKeysPanel({ triggerClassName }: { triggerClassName?: string }) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ keys: ApiKeyRow[] }>("/api-keys");
      setKeys(data.keys);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const data = await apiFetch<{ key: string; prefix: string; name: string }>("/api-keys", {
        method: "POST",
        body: { action: "create", name: newKeyName || "Default" },
      });
      setCreatedKey(data.key);
      setShowKey(true);
      setNewKeyName("");
      toast.success("API key created — save it now!");
      fetchKeys();
    } catch (err: any) {
      toast.error(err.message || "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    try {
      await apiFetch("/api-keys", { method: "POST", body: { action: "revoke", keyId } });
      toast.success("Key revoked");
      fetchKeys();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className={triggerClassName || "inline-flex items-center gap-2 border border-primary/30 text-primary font-mono text-xs px-3 py-1.5 rounded-md hover:bg-primary/10 transition-colors"}>
          <Key className="w-3 h-3" /> API KEYS
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-background border-primary/30">
        <DialogHeader>
          <DialogTitle className="font-mono text-primary flex items-center gap-2">
            <Key className="w-4 h-4" /> DEVELOPER API KEYS
          </DialogTitle>
        </DialogHeader>

        {/* Create new key */}
        <div className="flex gap-2 mt-2">
          <Input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. My App)"
            className="font-mono text-xs bg-background border-primary/20"
            maxLength={100}
          />
          <Button onClick={handleCreate} disabled={creating} size="sm" className="gap-1 font-mono text-xs">
            <Plus className="w-3 h-3" /> CREATE
          </Button>
        </div>

        {/* Newly created key — show once */}
        {createdKey && (
          <div className="p-3 bg-primary/5 border border-primary/30 rounded-md space-y-2">
            <p className="text-xs text-destructive font-mono">⚠ SAVE THIS KEY — it won't be shown again</p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-foreground break-all flex-1">
                {showKey ? createdKey : "•".repeat(40)}
              </code>
              <Button variant="ghost" size="sm" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => copyKey(createdKey)}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}

        {/* Key list */}
        <div className="space-y-2 max-h-60 overflow-y-auto mt-2">
          {loading && <p className="text-xs text-muted-foreground font-mono">Loading...</p>}
          {!loading && keys.length === 0 && (
            <p className="text-xs text-muted-foreground font-mono">No API keys yet</p>
          )}
          {keys.map((k) => (
            <div key={k.id} className={`p-2 rounded border text-xs font-mono space-y-1 ${k.is_active ? "border-primary/20" : "border-muted opacity-50"}`}>
              <div className="flex items-center justify-between">
                <span className="text-foreground font-semibold">{k.name}</span>
                {k.is_active && (
                  <Button variant="ghost" size="sm" onClick={() => handleRevoke(k.id)} className="h-6 px-2 text-destructive hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
              <div className="text-muted-foreground">
                {k.key_prefix} · {k.total_requests} reqs · {k.total_credits} cr used
                {!k.is_active && " · REVOKED"}
              </div>
            </div>
          ))}
        </div>

        {/* API docs link */}
        <div className="pt-2 border-t border-primary/10">
          <p className="text-[10px] text-muted-foreground font-mono">
            Use your key with <code className="text-primary">X-API-Key</code> header.
            POST to <code className="text-primary">/api/v1/generate</code> with {`{prompt, model?, n?}`}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
