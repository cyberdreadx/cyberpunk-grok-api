import React, { useState } from "react";
import { Download, Maximize2, X, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GrokResult } from "@/hooks/useGrokApi";

interface ResultsGridProps {
  results: GrokResult[];
  isLoading: boolean;
  onClear: () => void;
}

const ResultsGrid: React.FC<ResultsGridProps> = ({ results, isLoading, onClear }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const expandedResult = results.find((r) => r.id === expandedId);

  if (results.length === 0 && !isLoading) {
    return (
      <div className="border border-dashed border-border rounded p-12 text-center">
        <div className="font-mono-share text-sm text-muted-foreground tracking-wider mb-2">
          <span className="text-primary/40">$</span> ls ./output/
        </div>
        <div className="font-mono-share text-xs text-muted-foreground/40">
          (empty) — submit a prompt to generate results
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="font-orbitron text-xs tracking-wider text-muted-foreground">
          OUTPUT [{results.length}]
        </div>
        {results.length > 0 && (
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

      {/* Loading skeleton */}
      {isLoading && (
        <div className="border border-primary/30 rounded p-1 animate-pulse-glow">
          <div className="aspect-square bg-muted rounded flex items-center justify-center">
            <div className="font-mono-share text-xs text-primary animate-flicker">
              RENDERING...
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {results.map((result, idx) => (
          <div
            key={result.id}
            className="group relative border border-border rounded overflow-hidden bg-card hover:border-primary/50 transition-all animate-slide-up"
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            {result.type === "image" ? (
              <img
                src={result.url}
                alt={result.revised_prompt || "Generated image"}
                className="w-full aspect-square object-cover"
                loading="lazy"
              />
            ) : (
              <video
                src={result.url}
                className="w-full aspect-video object-cover"
                controls
                muted
              />
            )}

            {/* Revised prompt below image on mobile */}
            {result.revised_prompt && (
              <div className="p-2.5 border-t border-border/50 sm:hidden">
                <div className="font-orbitron text-[9px] text-muted-foreground/60 tracking-wider mb-1">
                  PROMPT
                </div>
                <p className="font-rajdhani text-xs text-foreground/70 leading-relaxed line-clamp-3">
                  {result.revised_prompt}
                </p>
              </div>
            )}

            {/* Overlay — desktop hover */}
            <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:flex items-center justify-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="text-primary hover:bg-primary/20"
                onClick={() => setExpandedId(result.id)}
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-primary hover:bg-primary/20"
                asChild
              >
                <a href={result.url} target="_blank" rel="noopener noreferrer" download>
                  <Download className="w-4 h-4" />
                </a>
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
            </div>

            {/* Mobile action bar */}
            <div className="flex items-center justify-between px-2 py-1.5 border-t border-border/30 sm:hidden">
              <Button
                size="sm"
                variant="ghost"
                className="text-primary text-xs gap-1 h-7 px-2"
                onClick={() => setExpandedId(result.id)}
              >
                <Maximize2 className="w-3 h-3" />
                View
              </Button>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="text-primary h-7 w-7" asChild>
                  <a href={result.url} target="_blank" rel="noopener noreferrer" download>
                    <Download className="w-3 h-3" />
                  </a>
                </Button>
                <Button size="icon" variant="ghost" className="text-primary h-7 w-7" asChild>
                  <a href={result.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </Button>
              </div>
            </div>

            {/* Type badge */}
            <div className="absolute top-2 left-2 font-mono-share text-[9px] bg-background/80 text-primary px-1.5 py-0.5 rounded">
              {result.type.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

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
            <Button
              size="icon"
              variant="ghost"
              className="absolute -top-10 right-0 sm:-top-12 text-foreground hover:text-primary z-10"
              onClick={() => setExpandedId(null)}
            >
              <X className="w-5 h-5" />
            </Button>

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
              />
            )}

            {expandedResult.revised_prompt && (
              <div className="mt-2 sm:mt-3 p-3 bg-card border border-border rounded overflow-y-auto max-h-[25vh]">
                <div className="font-orbitron text-[10px] text-muted-foreground tracking-wider mb-1">
                  REVISED_PROMPT
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
