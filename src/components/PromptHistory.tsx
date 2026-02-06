import React, { useState } from "react";
import { History, X, Trash2, Clock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { PromptHistoryEntry } from "@/hooks/usePromptHistory";

interface PromptHistoryProps {
  history: PromptHistoryEntry[];
  onSelect: (prompt: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const PromptHistory: React.FC<PromptHistoryProps> = ({ history, onSelect, onRemove, onClear }) => {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? history.filter((e) => e.prompt.toLowerCase().includes(search.toLowerCase()))
    : history;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString();
  };

  if (history.length === 0) return null;

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 w-full group">
        <span className="font-mono-share text-secondary/40 text-xs group-data-[state=open]:text-secondary/60">❯</span>
        <History className="w-3.5 h-3.5 text-muted-foreground group-hover:text-secondary transition-colors group-data-[state=open]:text-secondary" />
        <span className="font-mono-share text-[10px] tracking-widest text-muted-foreground group-hover:text-secondary transition-colors group-data-[state=open]:text-secondary">
          history --list
        </span>
        <div className="h-px flex-1 bg-border/50" />
        <span className="font-mono-share text-[9px] text-muted-foreground/30">
          {history.length} entries
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-3 animate-slide-up">
        {/* Search + Clear */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts..."
              className="bg-input border-border font-mono-share text-xs pl-7 h-8 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-destructive hover:text-destructive/80 font-mono-share text-[10px] h-8 px-2"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            PURGE
          </Button>
        </div>

        {/* Entries */}
        <div className="max-h-48 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="font-mono-share text-[10px] text-muted-foreground/50 text-center py-3">
              No matching prompts
            </p>
          ) : (
            filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelect(entry.prompt)}
                className="w-full group/item flex items-start gap-2 p-2 rounded border border-transparent hover:border-secondary/30 hover:bg-secondary/5 transition-all text-left"
              >
                <Clock className="w-3 h-3 mt-0.5 text-muted-foreground/40 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-rajdhani text-sm text-foreground/80 truncate group-hover/item:text-foreground transition-colors">
                    {entry.prompt}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono-share text-[9px] text-muted-foreground/40">
                      {entry.mode.toUpperCase().replace(/-/g, "_")}
                    </span>
                    <span className="font-mono-share text-[9px] text-muted-foreground/30">
                      {formatTime(entry.timestamp)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(entry.id);
                  }}
                  className="opacity-0 group-hover/item:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </button>
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default PromptHistory;
