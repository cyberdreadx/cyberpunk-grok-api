import React from "react";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface VerifiedBadgeProps {
  className?: string;
  size?: "xs" | "sm" | "md";
  title?: string;
}

const SIZE: Record<string, string> = {
  xs: "w-3 h-3",
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
};

/**
 * Cyan blue check shown next to verified creators' usernames.
 * Visible to everyone. Tooltip explains the badge.
 */
const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({ className, size = "sm", title }) => {
  return (
    <span title={title || "Verified creator — identity confirmed"} className="inline-flex shrink-0">
      <BadgeCheck
        className={cn("text-primary fill-primary/20", SIZE[size], className)}
        strokeWidth={2.5}
        aria-label="Verified creator"
      />
    </span>
  );
};

export default VerifiedBadge;
