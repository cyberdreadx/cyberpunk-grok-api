import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MessageSquare } from "lucide-react";

interface CharRow {
  id: string;
  name: string;
  is_public: boolean;
}

/**
 * Lets creators pick their official published Character and toggle fan-facing
 * “AI persona chat” discovery (profile + /creators).
 */
export default function CreatorPersonaChatPanel() {
  const [chars, setChars] = useState<CharRow[]>([]);
  const [officialId, setOfficialId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await apiFetch<{
        officialCharacterId: string | null;
        creatorPersonaChatEnabled: boolean;
        characters: CharRow[];
      }>("/creator-persona-chat", { method: "POST", body: { action: "get" } });
      setOfficialId(data.officialCharacterId || null);
      setEnabled(!!data.creatorPersonaChatEnabled);
      setChars(data.characters || []);
    } catch {
      setChars([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (nextOfficial: string | null | undefined, nextEnabled?: boolean) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { action: "set" };
      if (nextOfficial !== undefined) body.officialCharacterId = nextOfficial;
      if (nextEnabled !== undefined) body.creatorPersonaChatEnabled = nextEnabled;
      const data = await apiFetch<{
        officialCharacterId: string | null;
        creatorPersonaChatEnabled: boolean;
      }>("/creator-persona-chat", { method: "POST", body });
      setOfficialId(data.officialCharacterId || null);
      setEnabled(!!data.creatorPersonaChatEnabled);
    } finally {
      setSaving(false);
    }
  };

  const published = chars.filter((c) => c.is_public);

  return (
    <div className="border border-secondary/30 rounded-lg p-4 bg-card/40 space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-secondary" />
        <h3 className="font-orbitron text-xs tracking-wider text-foreground">CREATOR PERSONA CHAT</h3>
      </div>
      <p className="font-mono-share text-[10px] text-muted-foreground leading-relaxed">
        Link one published character as your official AI persona. Fans see a chat button on your profile and in the creators directory.
        First 3 messages per day with your persona are free for each fan; then 1 credit per reply (discounts apply).
      </p>

      {loading ? (
        <p className="font-mono-share text-[10px] text-muted-foreground animate-pulse">Loading…</p>
      ) : published.length === 0 ? (
        <p className="font-mono-share text-[10px] text-amber-400/90">
          Publish a character under Characters → enable “Public”, then return here to link it.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <Label className="font-mono-share text-[9px] text-muted-foreground">Official persona</Label>
            <select
              className="w-full h-9 rounded-md border border-border bg-background px-2 font-mono-share text-xs"
              value={officialId || ""}
              onChange={(e) => {
                const v = e.target.value || null;
                setOfficialId(v);
                if (!v) {
                  setEnabled(false);
                  save(null, false);
                } else {
                  save(v, undefined);
                }
              }}
              disabled={saving}
            >
              <option value="">— Select —</option>
              {published.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <div className="font-mono-share text-[10px] text-foreground">Fan chat enabled</div>
              <div className="font-mono-share text-[9px] text-muted-foreground">Show chat on profile &amp; /creators</div>
            </div>
            <Switch
              checked={enabled}
              disabled={saving || !officialId}
              onCheckedChange={(v) => {
                setEnabled(v);
                save(undefined, v);
              }}
            />
          </div>
          <Button variant="outline" size="sm" className="font-mono-share text-[10px] h-8" asChild>
            <a href="/characters">Edit characters</a>
          </Button>
        </>
      )}
    </div>
  );
}
