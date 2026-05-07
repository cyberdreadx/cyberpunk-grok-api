import { ShieldCheck, BadgeCheck } from "lucide-react";

export interface CreatorCardData {
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  niche?: string | null;
  verification_status?: string | null;
}

interface Props {
  data: CreatorCardData;
  /** Show "VERIFIED SOON" overlay (apply preview). When false, uses verification_status. */
  pendingBadge?: boolean;
  className?: string;
}

export default function CreatorPreviewCard({ data, pendingBadge = false, className = "" }: Props) {
  const initial = (data.display_name || data.username || "?").slice(0, 1).toUpperCase();
  const verified = data.verification_status === "verified";
  return (
    <div
      className={`border border-border/40 rounded-lg overflow-hidden bg-card/40 hover:border-secondary/60 transition-colors ${className}`}
    >
      <div className="aspect-square bg-muted/20 flex items-center justify-center overflow-hidden relative">
        {data.avatar_url ? (
          <img
            src={data.avatar_url}
            alt={data.display_name || data.username || ""}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="font-orbitron text-3xl text-muted-foreground/40">{initial}</span>
        )}
        {pendingBadge && (
          <span className="absolute top-1 left-1 font-mono-share text-[8px] tracking-widest px-1.5 py-0.5 rounded bg-background/70 text-secondary border border-secondary/40">
            VERIFIED SOON
          </span>
        )}
      </div>
      <div className="p-3 space-y-1">
        <div className="flex items-center gap-1 font-orbitron text-xs truncate">
          {data.display_name || data.username || "Display name"}
          {pendingBadge ? (
            <ShieldCheck className="w-3 h-3 text-secondary/60 shrink-0" />
          ) : (
            verified && <BadgeCheck className="w-3 h-3 text-secondary shrink-0" />
          )}
        </div>
        {(data.username || pendingBadge) && (
          <div className="font-mono-share text-[10px] text-muted-foreground truncate">
            @{data.username || "handle"}
          </div>
        )}
        {data.niche && (
          <div className="font-mono-share text-[9px] text-secondary/70 truncate">{data.niche}</div>
        )}
      </div>
    </div>
  );
}
