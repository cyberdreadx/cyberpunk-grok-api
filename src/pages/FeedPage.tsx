import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import CyberLayout from "@/components/CyberLayout";
import CreatorCard, { type FeedCreator } from "@/components/CreatorCard";
import CreatorPanel from "@/components/CreatorPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Send, Users, Globe, Loader2, Plus, X, Lock, Zap, ShieldAlert, Sparkles, Rss, Flame, Film, FolderOpen, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import MobileBottomNav from "@/components/MobileBottomNav";
import MobileCreditsPill from "@/components/MobileCreditsPill";
import FeatureExplainer from "@/components/FeatureExplainer";
import ReelViewer from "@/components/ReelViewer";
import StoriesBar from "@/components/StoriesBar";
import SignupTeaser from "@/components/SignupTeaser";
import StoreOverlay from "@/components/StoreOverlay";
import PreferencesDialog from "@/components/PreferencesDialog";
import LibraryPicker from "@/components/LibraryPicker";
import KarmaBadge from "@/components/KarmaBadge";
import { uploadLibraryItemForPost } from "@/lib/postMedia";
import type { GrokResult } from "@/hooks/useGrokApi";

const FEED_RULES = [
  "No illegal content of any kind",
  "No underage or child exploitation content — zero tolerance",
  "No non-consensual intimate imagery (real or AI-generated)",
  "No doxxing, harassment, threats, or incitement of violence",
  "No spam, scams, phishing, or malicious links",
  "No impersonation of other users or public figures",
  "No promotion of self-harm, terrorism, or hate speech",
  "No posting of copyrighted content you don't own",
];

const FeedPage: React.FC = () => {
  const { user, isAuthenticated, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [rulesAcked, setRulesAcked] = useState(() => localStorage.getItem("feed-rules-acked") === "1");
  const [showRules, setShowRules] = useState(false);

  const [creators, setCreators] = useState<FeedCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "following" | "trending">("all");
  const [newText, setNewText] = useState("");
  const [posting, setPosting] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockCredits, setLockCredits] = useState("");
  const [storeOpen, setStoreOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [lockPrice, setLockPrice] = useState("");
  const [matureFlag, setMatureFlag] = useState(false);
  const [lockXrge, setLockXrge] = useState("");
  const [activeCreator, setActiveCreator] = useState<FeedCreator | null>(null);
  const [reelTarget, setReelTarget] = useState<{ postId: string; userId?: string } | null>(null);
  const [reelsOpen, setReelsOpen] = useState(false);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [pickedMedia, setPickedMedia] = useState<{ url: string; type: "image" | "video"; prompt?: string } | null>(null);
  const [uploadingPick, setUploadingPick] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Idempotency key — regenerated for each fresh compose session and after
  // a successful post. Reused across retries so the server can dedupe a
  // double-click into a single post.
  const idempotencyKeyRef = useRef<string>("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const ensureIdempotencyKey = useCallback(() => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? (crypto as any).randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return idempotencyKeyRef.current;
  }, []);

  const requireAuth = useCallback(() => {
    if (!isAuthenticated) {
      toast({ title: "Sign in to post", description: "Create an account to share with the community." });
      navigate("/create");
      return false;
    }
    return true;
  }, [isAuthenticated, toast, navigate]);

  const fetchCreators = useCallback(async (cursor?: string) => {
    try {
      const params = new URLSearchParams({ view: "creators" });
      if (filter === "following") params.set("filter", "following");
      if (filter === "trending") params.set("sort", "trending");
      if (cursor) params.set("cursor", cursor);
      const data = await apiFetch<{ creators: FeedCreator[]; nextCursor: string | null }>(
        `/feed?${params.toString()}`
      );
      if (cursor) {
        setCreators((prev) => {
          const seen = new Set(prev.map((c) => c.userId));
          const merged = [...prev];
          for (const c of data.creators) {
            if (!seen.has(c.userId)) {
              seen.add(c.userId);
              merged.push(c);
            }
          }
          return merged;
        });
      } else {
        setCreators(data.creators);
      }
      // Guard against the server returning the same cursor (would loop forever).
      setNextCursor((prevCursor) => (data.nextCursor && data.nextCursor !== cursor ? data.nextCursor : null));
    } catch {
      toast({ title: "Failed to load feed", variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    fetchCreators();
  }, [authLoading, isAuthenticated, fetchCreators]);

  // Open ReelViewer when arriving from a notification click
  useEffect(() => {
    if (!isAuthenticated) return;
    const stashed = sessionStorage.getItem("openReelPostId");
    if (stashed) {
      sessionStorage.removeItem("openReelPostId");
      setReelTarget({ postId: stashed });
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.postId) setReelTarget({ postId: detail.postId });
    };
    window.addEventListener("open-reel", handler);
    return () => window.removeEventListener("open-reel", handler);
  }, [isAuthenticated]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor || loadingMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setLoadingMore(true);
        fetchCreators(nextCursor);
      }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, loadingMore, fetchCreators]);

  const submitPost = async () => {
    if (!newText.trim() && !pickedMedia) return;
    setPosting(true);
    try {
      const body: any = { text: newText.trim() };
      if (pickedMedia) body.imageUrl = pickedMedia.url;
      if (matureFlag) body.isMature = true;
      if (lockEnabled) {
        if (lockCredits) body.lockCost = parseInt(lockCredits) || 0;
        if (lockPrice) body.lockPriceCents = Math.round(parseFloat(lockPrice) * 100) || 0;
        if (lockXrge) body.lockXrgeAmount = lockXrge;
      }
      const key = ensureIdempotencyKey();
      const result = await apiFetch<{ id: string; idempotent?: boolean }>("/feed", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": key },
      });
      if (result?.idempotent) {
        toast({ title: "Already posted", description: "Your previous attempt already went through." });
      }
      // Reset compose for the next post — including a fresh idempotency key.
      idempotencyKeyRef.current = "";
      setNewText("");
      setShowCompose(false);
      setConfirmOpen(false);
      setLockEnabled(false);
      setMatureFlag(false);
      setLockCredits("");
      setLockPrice("");
      setLockXrge("");
      setPickedMedia(null);
      setLoading(true);
      fetchCreators();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  /** Click-handler for the POST button: opens confirmation instead of submitting directly. */
  const handlePost = () => {
    if (posting) return; // double-click guard
    if (!newText.trim() && !pickedMedia) return;
    ensureIdempotencyKey();
    setConfirmOpen(true);
  };

  const handlePickFromLibrary = useCallback(async (result: GrokResult) => {
    setUploadingPick(true);
    try {
      const url = await uploadLibraryItemForPost(result);
      setPickedMedia({ url, type: result.type, prompt: result.revised_prompt });
      // If user hasn't typed anything, prefill with the prompt for context.
      setNewText((cur) => (cur.trim() ? cur : (result.revised_prompt || "")));
      setLibraryPickerOpen(false);
    } catch (err: any) {
      toast({ title: err?.message || "Failed to attach media", variant: "destructive" });
    } finally {
      setUploadingPick(false);
    }
  }, [toast]);

  const ackRules = () => {
    localStorage.setItem("feed-rules-acked", "1");
    setRulesAcked(true);
  };

  const openCreator = (c: FeedCreator) => {
    // Logged-out users get nudged to sign up instead of viewing locked previews.
    if (!isAuthenticated) {
      toast({ title: "Sign up to view posts", description: "Create a free account to unlock the feed." });
      navigate("/create?signup=1");
      return;
    }
    // Open the immersive reel viewer focused on this creator's latest post.
    setReelTarget({ postId: c.latestPostId, userId: c.userId });
  };

  const openProfile = (c: FeedCreator) => {
    if (isMobile) navigate(`/profile/${c.username}`);
    else setActiveCreator(c);
  };

  const rulesBanner = !rulesAcked || showRules ? (
    <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />
        <h2 className="font-orbitron text-xs tracking-wider text-destructive">COMMUNITY GUIDELINES</h2>
      </div>
      <p className="font-mono-share text-[10px] text-muted-foreground leading-relaxed">
        By posting, you agree to follow these rules. Violations will result in content removal and account bans.
      </p>
      <ul className="space-y-1.5">
        {FEED_RULES.map((rule, i) => (
          <li key={i} className="font-mono-share text-[10px] text-foreground/80 flex items-start gap-2">
            <span className="text-destructive mt-0.5 shrink-0">▸</span>
            {rule}
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => { ackRules(); setShowRules(false); }}
        className="font-mono-share text-[10px] w-full"
      >
        I UNDERSTAND — CONTINUE
      </Button>
    </div>
  ) : null;

  // Karma / posting eligibility strip — always shown to authenticated users.
  const karmaStrip = isAuthenticated && user?.posting ? (
    <KarmaBadge posting={user.posting} onOpenStore={() => setStoreOpen(true)} />
  ) : null;

  const lockControls = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch checked={lockEnabled} onCheckedChange={setLockEnabled} />
        <span className="font-mono-share text-[10px] text-muted-foreground flex items-center gap-1">
          <Lock className="w-3 h-3" /> Lock this post
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={matureFlag} onCheckedChange={setMatureFlag} />
        <span className={`font-mono-share text-[10px] flex items-center gap-1 ${matureFlag ? "text-amber-300" : "text-muted-foreground"}`}>
          <ShieldAlert className="w-3 h-3" /> Mark as 18+ / mature
        </span>
      </div>
      {lockEnabled && (
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[80px]">
            <label className="font-mono-share text-[9px] text-muted-foreground block mb-1">Credits</label>
            <Input type="number" min="0" max="100" placeholder="e.g. 5" value={lockCredits}
              onChange={(e) => setLockCredits(e.target.value)} className="font-mono-share text-xs h-8" />
          </div>
          <div className="flex-1 min-w-[80px]">
            <label className="font-mono-share text-[9px] text-muted-foreground block mb-1">USD ($)</label>
            <Input type="number" min="0" max="100" step="0.01" placeholder="e.g. 2.99" value={lockPrice}
              onChange={(e) => setLockPrice(e.target.value)} className="font-mono-share text-xs h-8" />
          </div>
          <div className="flex-1 min-w-[80px]">
            <label className="font-mono-share text-[9px] text-muted-foreground flex items-center gap-1 block mb-1">
              <Zap className="w-3 h-3 text-secondary" /> XRGE
            </label>
            <Input type="number" min="0" step="0.01" placeholder="e.g. 100" value={lockXrge}
              onChange={(e) => setLockXrge(e.target.value)} className="font-mono-share text-xs h-8" />
          </div>
        </div>
      )}
    </div>
  );

  const attachControls = (
    <div className="space-y-2">
      {pickedMedia ? (
        <div className="relative inline-block rounded-md overflow-hidden border border-primary/40 bg-card/40">
          {pickedMedia.type === "video" ? (
            <video src={pickedMedia.url} muted playsInline className="h-24 w-24 object-cover" />
          ) : (
            <img src={pickedMedia.url} alt="Selected media" className="h-24 w-24 object-cover" />
          )}
          <button
            type="button"
            onClick={() => setPickedMedia(null)}
            className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 text-white hover:bg-black"
            aria-label="Remove attached media"
          >
            <X className="w-3 h-3" />
          </button>
          <div className="absolute bottom-1 left-1 bg-black/60 backdrop-blur-sm rounded px-1 py-0.5 flex items-center gap-1">
            {pickedMedia.type === "video"
              ? <Film className="w-2.5 h-2.5 text-white" />
              : <ImageIcon className="w-2.5 h-2.5 text-white" />}
            <span className="font-mono-share text-[8px] text-white tracking-wider">ATTACHED</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setLibraryPickerOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border/40 bg-card/40 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors font-mono-share text-[10px] tracking-wider"
        >
          <FolderOpen className="w-3.5 h-3.5" /> ADD FROM LIBRARY
        </button>
      )}
    </div>
  );

  const confirmDialog = (
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(open) => {
        // Block dismiss while a request is in flight to keep the idempotency
        // key + UI state stable until we know the outcome.
        if (!posting) setConfirmOpen(open);
      }}
    >
      <AlertDialogContent className="bg-card border-border/50">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-orbitron text-sm tracking-widest text-primary">
            POST TO FEED?
          </AlertDialogTitle>
          <AlertDialogDescription className="font-mono-share text-[11px] text-muted-foreground space-y-2">
            <span className="block">Your post will be visible to the community. Please review the details below before publishing.</span>
            {newText.trim() && (
              <span className="block bg-input/30 border border-border/30 rounded p-2 text-foreground/80 max-h-24 overflow-y-auto">
                "{newText.trim().slice(0, 200)}{newText.trim().length > 200 ? "…" : ""}"
              </span>
            )}
            {pickedMedia && (
              <span className="flex items-center gap-2 text-foreground/70">
                {pickedMedia.type === "video"
                  ? <Film className="w-3 h-3 text-secondary" />
                  : <ImageIcon className="w-3 h-3 text-primary" />}
                Media attached from your library
              </span>
            )}
            {matureFlag && (
              <span className="flex items-center gap-1 text-amber-300">
                <ShieldAlert className="w-3 h-3" /> Marked 18+ / mature
              </span>
            )}
            {lockEnabled && (lockCredits || lockPrice || lockXrge) && (
              <span className="flex items-center gap-1 text-secondary">
                <Lock className="w-3 h-3" /> Locked
                {lockCredits && ` · ${lockCredits} credits`}
                {lockPrice && ` · $${lockPrice}`}
                {lockXrge && ` · ${lockXrge} XRGE`}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={posting} className="font-mono-share text-[11px]">
            CANCEL
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={posting}
            onClick={(e) => {
              e.preventDefault(); // keep dialog open until submit resolves
              if (!posting) submitPost();
            }}
            className="font-mono-share text-[11px] bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {posting ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> POSTING…</>
            ) : (
              <><Send className="w-3 h-3 mr-1" /> CONFIRM POST</>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const filterTabs = (variant: "mobile" | "desktop") => {
    const baseInactive = variant === "mobile"
      ? "border-white/10 bg-black/30 text-white/70 backdrop-blur-sm"
      : "border-border/30 text-muted-foreground hover:text-foreground";
    return (
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => { setFilter("all"); setLoading(true); }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-mono-share text-[10px] transition-colors border ${
            filter === "all" ? "border-primary/50 bg-primary/10 text-primary" : baseInactive
          }`}
        >
          <Globe className="w-3 h-3" /> ALL
        </button>
        <button
          onClick={() => { setFilter("trending"); setLoading(true); }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-mono-share text-[10px] transition-colors border ${
            filter === "trending"
              ? "border-secondary/50 bg-secondary/10 text-secondary shadow-[0_0_8px_hsl(var(--secondary)/0.3)]"
              : baseInactive
          }`}
        >
          <Flame className="w-3 h-3" /> TRENDING
        </button>
        <button
          onClick={() => { if (requireAuth()) { setFilter("following"); setLoading(true); } }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-mono-share text-[10px] transition-colors border ${
            filter === "following" ? "border-primary/50 bg-primary/10 text-primary" : baseInactive
          }`}
        >
          <Users className="w-3 h-3" /> FOLLOWING
        </button>
        <button
          onClick={() => {
            if (!isAuthenticated) {
              toast({ title: "Sign up to watch reels", description: "Create a free account to watch the video feed." });
              navigate("/create?signup=1");
              return;
            }
            setReelsOpen(true);
          }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-mono-share text-[10px] transition-colors border border-accent/50 bg-accent/10 text-accent shadow-[0_0_8px_hsl(var(--accent)/0.25)] hover:bg-accent/20`}
          title="Vertical video reels"
        >
          <Film className="w-3 h-3" /> REELS
        </button>
      </div>
    );
  };

  /** Top tab strip: Feed (current page) / Create (navigates to /create). */
  const topTabs = (
    <div className="flex items-center gap-1 p-1 rounded-lg border border-border/40 bg-card/40 w-fit">
      <button
        type="button"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md font-orbitron text-[10px] tracking-widest bg-primary/15 text-primary border border-primary/40 shadow-[0_0_8px_hsl(var(--primary)/0.25)]"
        aria-current="page"
      >
        <Rss className="w-3.5 h-3.5" /> FEED
      </button>
      <button
        type="button"
        onClick={() => navigate("/create")}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md font-orbitron text-[10px] tracking-widest text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5" /> CREATE
      </button>
    </div>
  );

  const skeletonGrid = (cols: string) => (
    <div className={`grid ${cols} gap-3`}>
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="aspect-[3/4] rounded-lg overflow-hidden bg-card/40 border border-border/30 animate-in fade-in duration-300"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <Skeleton className="w-full h-3/4" />
          <div className="p-2 flex items-center gap-2">
            <Skeleton className="w-7 h-7 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-2 w-20 rounded" />
              <Skeleton className="h-2 w-12 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  /* ───── MOBILE GRID VIEW ───── */
  if (isMobile) {
    return (
      <>
        {isAuthenticated && (!rulesAcked || showRules) && (
          <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="max-w-sm w-full space-y-3">
              {rulesBanner}
              {karmaStrip}
            </div>
          </div>
        )}
        <div className="min-h-[100dvh] bg-background pb-24">
          {/* Sticky header */}
          <div
            className="sticky z-30 bg-background/85 backdrop-blur-md border-b border-border/30 px-3 py-2 space-y-2"
            style={{ top: 0, paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
          >
            <div className="flex items-center justify-between gap-2 mobile-pill-clear">
              {topTabs}
              <button
                onClick={() => setShowRules(true)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label="View community guidelines"
              >
                <ShieldAlert className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-end">
              {filterTabs("mobile")}
            </div>
          </div>

          {/* Signup teaser for logged-out users */}
          {!authLoading && !isAuthenticated && (
            <div className="px-3 pt-3">
              <SignupTeaser variant="mobile" />
            </div>
          )}

          {/* Stories */}
          <div className="px-3 pt-3">
            <StoriesBar currentUserId={user?.id} isAdmin={!!user?.is_admin} />
          </div>

          {/* Grid — edge-to-edge so cards' borders touch */}
          <div className="pt-3">
            {loading ? (
              <div className="px-3">{skeletonGrid("grid-cols-2")}</div>
            ) : creators.length === 0 ? (
              <div className="py-16 text-center">
                <p className="font-mono-share text-xs text-muted-foreground">
                  {filter === "following" ? "Follow users to see their posts here" : "No creators yet. Be the first to post!"}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-0 -mx-px">
                  {creators.map((c) => (
                    <div key={c.userId} className="-ml-px -mt-px">
                      <CreatorCard creator={c} onOpen={openCreator} forceBlur={!isAuthenticated} />
                    </div>
                  ))}
                </div>
                <div ref={sentinelRef} className="h-12 flex items-center justify-center">
                  {loadingMore && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
                </div>
                {!loadingMore && !nextCursor && creators.length > 0 && (
                  <div className="py-6 text-center">
                    <p className="font-mono-share text-[10px] tracking-widest text-muted-foreground/70">
                      ── YOU'RE ALL CAUGHT UP ──
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Floating compose button */}
        <button
          onClick={() => { if (requireAuth()) setShowCompose(true); }}
          className="fixed z-40 right-4 bg-primary text-primary-foreground w-12 h-12 rounded-full flex items-center justify-center shadow-lg shadow-primary/30 active:scale-90 transition-transform"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
          aria-label="Create post"
        >
          <Plus className="w-6 h-6" />
        </button>

        {/* Compose sheet */}
        {showCompose && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[env(safe-area-inset-top,0px)]"
            onClick={() => {
              if (posting) return;
              setShowCompose(false);
              idempotencyKeyRef.current = "";
            }}
          >
            <div
              className="w-[calc(100%-32px)] mt-16 bg-card rounded-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-200 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <span className="font-orbitron text-xs text-foreground tracking-wider">NEW POST</span>
                <button
                  onClick={() => {
                    if (posting) return;
                    setShowCompose(false);
                    idempotencyKeyRef.current = "";
                  }}
                  className="text-muted-foreground p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <Textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Share something..."
                maxLength={2000}
                rows={3}
                autoFocus
                className="font-mono-share text-sm bg-input/50 resize-none border-border/30 focus:border-primary/50"
              />
              {attachControls}
              {lockControls}
              <div className="flex items-center justify-between">
                <span className="font-mono-share text-[9px] text-muted-foreground">{newText.length}/2000</span>
                <Button size="sm" onClick={handlePost} disabled={posting || (!newText.trim() && !pickedMedia)} className="font-mono-share text-[10px]">
                  {posting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                  POST
                </Button>
              </div>
            </div>
          </div>
        )}

        <MobileCreditsPill onOpenStore={() => setStoreOpen(true)} />
        <MobileBottomNav isAuthenticated={isAuthenticated} onOpenStore={() => setStoreOpen(true)} onOpenSettings={() => setPrefsOpen(true)} />
        <StoreOverlay open={storeOpen} onOpenChange={setStoreOpen} />
        <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
        <FeatureExplainer feature="feed" />
        <LibraryPicker
          open={libraryPickerOpen}
          onClose={() => setLibraryPickerOpen(false)}
          onSelect={handlePickFromLibrary}
          busy={uploadingPick}
        />
        {confirmDialog}
        {reelTarget && (
          <ReelViewer
            open
            onClose={() => setReelTarget(null)}
            initialPostId={reelTarget.postId}
            userId={reelTarget.userId}
            filter={filter}
          />
        )}
        {reelsOpen && (
          <ReelViewer
            open
            onClose={() => setReelsOpen(false)}
            initialPostId=""
            mediaType="video"
          />
        )}
      </>
    );
  }

  /* ───── DESKTOP GRID VIEW ───── */
  return (
    <CyberLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4 pb-24">
        {/* Top tabs + actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {topTabs}
            <button
              onClick={() => setShowRules(true)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="View community guidelines"
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated && (
              <button
                onClick={() => navigate("/profile")}
                className="font-mono-share text-[10px] text-primary hover:text-primary/80 transition-colors"
              >
                MY PROFILE →
              </button>
            )}
          </div>
        </div>

        {isAuthenticated && rulesBanner}
        {karmaStrip}

        {/* Stories at the very top */}
        <StoriesBar currentUserId={user?.id} isAdmin={!!user?.is_admin} />

        {isAuthenticated ? (
          <div className="bg-card/60 border border-border/40 rounded-lg p-4 space-y-3">
            <Textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Share something with the community..."
              maxLength={2000}
              rows={3}
              className="font-mono-share text-sm bg-input/50 resize-none border-border/30 focus:border-primary/50"
            />
            {attachControls}
            {lockControls}
            <div className="flex items-center justify-between">
              <span className="font-mono-share text-[9px] text-muted-foreground">{newText.length}/2000</span>
              <Button size="sm" onClick={handlePost} disabled={posting || (!newText.trim() && !pickedMedia)} className="font-mono-share text-[10px]">
                {posting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                POST
              </Button>
            </div>
          </div>
        ) : (
          <SignupTeaser variant="desktop" />
        )}

        {filterTabs("desktop")}

        {loading ? (
          skeletonGrid("grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5")
        ) : creators.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-mono-share text-xs text-muted-foreground">
              {filter === "following" ? "Follow users to see their posts here" : "No creators yet. Be the first to post!"}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-0">
              {creators.map((c) => (
                <div key={c.userId} className="-ml-px -mt-px">
                  <CreatorCard
                    creator={c}
                    onOpen={openCreator}
                    active={activeCreator?.userId === c.userId}
                    forceBlur={!isAuthenticated}
                  />
                </div>
              ))}
            </div>
            <div ref={sentinelRef} className="h-12 flex items-center justify-center">
              {loadingMore && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
            </div>
            {!loadingMore && !nextCursor && creators.length > 0 && (
              <div className="py-8 text-center">
                <p className="font-mono-share text-[10px] tracking-widest text-muted-foreground/70">
                  ── YOU'RE ALL CAUGHT UP ──
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <CreatorPanel creator={activeCreator} onClose={() => setActiveCreator(null)} />
      <MobileCreditsPill onOpenStore={() => setStoreOpen(true)} />
      <MobileBottomNav isAuthenticated={isAuthenticated} onOpenStore={() => setStoreOpen(true)} onOpenSettings={() => setPrefsOpen(true)} />
      <StoreOverlay open={storeOpen} onOpenChange={setStoreOpen} />
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
      <FeatureExplainer feature="feed" />
      <LibraryPicker
        open={libraryPickerOpen}
        onClose={() => setLibraryPickerOpen(false)}
        onSelect={handlePickFromLibrary}
        busy={uploadingPick}
      />
      {confirmDialog}
      {reelTarget && (
        <ReelViewer
          open
          onClose={() => setReelTarget(null)}
          initialPostId={reelTarget.postId}
          userId={reelTarget.userId}
          filter={filter}
        />
      )}
      {reelsOpen && (
        <ReelViewer
          open
          onClose={() => setReelsOpen(false)}
          initialPostId=""
          mediaType="video"
        />
      )}
    </CyberLayout>
  );
};

export default FeedPage;
