/**
 * The invite affordance that sits beside the credit balance.
 *
 * The referral programme was invisible: the only way to find a link was to open
 * the store dialog and scroll past the packs, and 79 of 2,960 signups in 90 days
 * came through one. It shows up when someone is nearly out of credits, which is
 * the moment they care about a way to get more that isn't paying.
 *
 * Deliberately quiet above the threshold — a permanent badge in the header
 * becomes furniture, and the people who have credits are busy using them.
 */
import React from "react";
import { Link } from "react-router-dom";
import { Gift } from "lucide-react";

/** Credits the inviter and the invited each receive; mirrors referral-rewards.ts. */
export const INVITE_REWARD = 15;

/** Below this, the pill appears. About three images' worth. */
export const INVITE_THRESHOLD = 10;

interface Props {
  credits: number;
  loading?: boolean;
  className?: string;
}

const InviteCredits: React.FC<Props> = ({ credits, loading = false, className = "" }) => {
  if (loading || credits > INVITE_THRESHOLD) return null;
  return (
    <Link
      to="/referral"
      aria-label={`Invite a friend — you both get ${INVITE_REWARD} credits when they create something`}
      title={`Invite a friend — you both get ${INVITE_REWARD} credits`}
      className={`group inline-flex items-center gap-1 h-7 px-2 rounded-full border border-green-500/40 bg-green-950/30 hover:bg-green-900/40 hover:border-green-400/60 active:scale-[0.97] transition-all ${className}`}
    >
      <Gift className="w-3 h-3 text-green-400 shrink-0" />
      <span className="font-orbitron text-tiny tracking-wider text-green-300 leading-none whitespace-nowrap">
        +{INVITE_REWARD}
      </span>
      <span className="hidden sm:inline font-orbitron text-tiny tracking-wider text-green-400/80 leading-none">
        Invite
      </span>
    </Link>
  );
};

export default InviteCredits;
