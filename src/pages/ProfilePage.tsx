import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import CyberLayout from "@/components/CyberLayout";
import PostCard from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, UserMinus, Edit2, Check, X, ArrowLeft, Camera, Loader2, Wallet, Ban, BadgeCheck, MessageSquare, Instagram, Link as LinkIcon, Mail } from "lucide-react";

const SOCIAL_KEYS = ["instagram", "x", "tiktok", "onlyfans", "other"] as const;
const SOCIAL_META: Record<string, { label: string; placeholder: string }> = {
  instagram: { label: "Instagram", placeholder: "https://instagram.com/you" },
  x: { label: "X", placeholder: "https://x.com/you" },
  tiktok: { label: "TikTok", placeholder: "https://tiktok.com/@you" },
  onlyfans: { label: "OnlyFans", placeholder: "https://onlyfans.com/you" },
  other: { label: "Link", placeholder: "https://..." },
};
const normalizeUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);
import EarningsPanel from "@/components/EarningsPanel";
import AdminUserPanel from "@/components/AdminUserPanel";
import EarnPromoBanner from "@/components/EarnPromoBanner";
import VerifiedBadge from "@/components/VerifiedBadge";
import VerificationDialog from "@/components/VerificationDialog";
import HolderBadge from "@/components/HolderBadge";
import { useToast } from "@/hooks/use-toast";
import { uploadPublicMedia } from "@/lib/mediaUpload";
import { normalizeToImageBlob } from "@/lib/heicConvert";
import MobileBottomNav from "@/components/MobileBottomNav";
import MobileCreditsPill from "@/components/MobileCreditsPill";
import StoreOverlay from "@/components/StoreOverlay";
import CreatorPersonaChatPanel from "@/components/CreatorPersonaChatPanel";
import PreferencesDialog from "@/components/PreferencesDialog";

interface Profile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  bio: string;
  walletAddress?: string | null;
  walletTruncated?: string | null;
  createdAt: string;
  followers: number;
  following: number;
  postCount: number;
  isOwn: boolean;
  isFollowing: boolean;
  isBanned?: boolean;
  banReason?: string | null;
  verified?: boolean;
  holderTier?: string;
  holderStreakDays?: number;
  holderTotalHeld?: number | null;
  /** Fan opens Characters chat with creator's official persona */
  personaChatCharacterId?: string | null;
  creatorPersonaChatEnabled?: boolean;
  officialCharacterId?: string | null;
  socials?: Record<string, string>;
}

interface FeedPost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  imageUrl: string | null;
  previewText?: string;
  createdAt: string;
  score: number;
  userVote: string | null;
  commentCount: number;
  flagCount?: number;
  userFlagged?: boolean;
  lockCost?: number;
  lockPriceCents?: number;
  lockXrgeAmount?: string;
  unlocked?: boolean;
  isOwner?: boolean;
  viewCount?: number;
}

const ProfilePage: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editWallet, setEditWallet] = useState("");
  const [editSocials, setEditSocials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [banLoading, setBanLoading] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const personaPhotoInputRef = useRef<HTMLInputElement>(null);
  const [personaPhotoUploading, setPersonaPhotoUploading] = useState(false);
  const fetchProfile = useCallback(async () => {
    try {
      const query = username ? `?username=${encodeURIComponent(username)}` : "";
      const data = await apiFetch<Profile>(`/profile${query}`);
      setProfile(data);
      setEditUsername(data.username);
      setEditBio(data.bio || "");
      setEditWallet(data.walletAddress || "");
      setEditSocials(data.socials && typeof data.socials === "object" ? data.socials : {});

      // Fetch user posts (non-fatal — profile still renders if this fails)
      try {
        const feed = await apiFetch<{ posts: FeedPost[] }>(`/feed?userId=${data.userId}`);
        setPosts(feed.posts);
      } catch (feedErr: any) {
        console.warn("[profile] failed to load posts:", feedErr?.message);
        setPosts([]);
      }
    } catch (err: any) {
      const msg = err?.message || "Profile not found";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [username, toast]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate("/");
      return;
    }
    fetchProfile();
  }, [authLoading, isAuthenticated, fetchProfile, navigate]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Normalize social URLs; drop blanks.
      const socialsOut: Record<string, string> = {};
      for (const k of SOCIAL_KEYS) {
        const v = (editSocials[k] || "").trim();
        if (v) socialsOut[k] = normalizeUrl(v);
      }
      await apiFetch("/profile", {
        method: "PUT",
        body: { username: editUsername, bio: editBio, walletAddress: editWallet || null, socials: socialsOut },
      });
      toast({ title: "Profile updated" });
      setEditing(false);
      fetchProfile();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image must be under 5 MB", variant: "destructive" });
      return;
    }
    setAvatarUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const { url: blobUrl } = await uploadPublicMedia(file, "avatars", `avatar.${ext}`);
      await apiFetch("/profile", {
        method: "PUT",
        body: { avatarUrl: blobUrl },
      });
      toast({ title: "Avatar updated!" });
      fetchProfile();
    } catch (err: any) {
      toast({ title: err.message || "Failed to upload avatar", variant: "destructive" });
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }, [toast, fetchProfile]);

  // Admin: replace a featured creator's persona character photo.
  const handlePersonaPhoto = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.officialCharacterId) return;
    setPersonaPhotoUploading(true);
    try {
      const maxDim = 512;
      const sourceBlob = await normalizeToImageBlob(file, 0.85);
      const bitmap = await createImageBitmap(sourceBlob);
      let w = bitmap.width, h = bitmap.height;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const portrait = canvas.toDataURL("image/jpeg", 0.85);
      await apiFetch("/characters", {
        method: "POST",
        body: { action: "admin-set-portrait", characterId: profile.officialCharacterId, portrait, alsoAvatar: true },
      });
      toast({ title: "Persona photo updated" });
      fetchProfile();
    } catch (err: any) {
      toast({ title: err?.message || "Could not update photo", variant: "destructive" });
    } finally {
      setPersonaPhotoUploading(false);
      if (personaPhotoInputRef.current) personaPhotoInputRef.current.value = "";
    }
  }, [profile?.officialCharacterId, toast, fetchProfile]);

  // Open a DM with this profile. If a thread already exists, /messages finds it
  // by userId; otherwise it opens a compose view and the first send creates it.
  const [dmLoading, setDmLoading] = useState(false);
  const startDm = () => {
    if (!profile) return;
    setDmLoading(true);
    navigate(`/messages?to=${encodeURIComponent(profile.userId)}&u=${encodeURIComponent(profile.username || "user")}`);
  };

  const handleFollow = async () => {
    if (!profile) return;
    setFollowLoading(true);
    try {
      const data = await apiFetch<{ action: string }>("/follows", {
        method: "POST",
        body: { targetUserId: profile.userId },
      });
      setProfile((p) =>
        p
          ? {
              ...p,
              isFollowing: data.action === "followed",
              followers: p.followers + (data.action === "followed" ? 1 : -1),
            }
          : p
      );
      toast({ title: data.action === "followed" ? `Following @${profile.username}` : `Unfollowed @${profile.username}` });
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <CyberLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="font-mono-share text-muted-foreground">LOADING PROFILE...</div>
        </div>
      </CyberLayout>
    );
  }

  if (!profile) {
    return (
      <CyberLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <p className="font-mono-share text-muted-foreground">USER NOT FOUND</p>
          <Button variant="outline" onClick={() => navigate("/feed")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Feed
          </Button>
        </div>
      </CyberLayout>
    );
  }

  return (
    <CyberLayout>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-24">
        {/* Back button */}
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors font-mono-share text-xs">
          <ArrowLeft className="w-3 h-3" /> BACK
        </button>

        {/* Profile header */}
        <div className="bg-card/60 border border-border/40 rounded-lg p-6 space-y-4">
          <div className="flex items-start gap-4">
          <div className="relative group">
              <Avatar className="w-16 h-16 border-2 border-primary/30">
                {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.username} />}
                <AvatarFallback className="bg-primary/10 text-primary font-orbitron text-lg">
                  {profile.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {profile.isOwn && (
                <>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {avatarUploading ? (
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    ) : (
                      <Camera className="w-5 h-5 text-primary" />
                    )}
                  </button>
                </>
              )}
            </div>

            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-3">
                  <div>
                    <label className="font-mono-share text-[10px] text-muted-foreground">USERNAME</label>
                    <Input
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      maxLength={24}
                      className="h-8 font-mono-share text-sm bg-input/50"
                    />
                  </div>
                  <div>
                    <label className="font-mono-share text-[10px] text-muted-foreground">BIO</label>
                    <Textarea
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      maxLength={300}
                      rows={3}
                      className="font-mono-share text-sm bg-input/50 resize-none"
                    />
                    <span className="font-mono-share text-[9px] text-muted-foreground">{editBio.length}/300</span>
                  </div>
                  <div>
                    <label className="font-mono-share text-[10px] text-muted-foreground flex items-center gap-1">
                      <Wallet className="w-3 h-3" /> WALLET_ADDRESS (Base chain)
                    </label>
                    {/* Read-only: the same column feeds holder tiers, so it can only
                        be set by connecting and signing in the $XRGE bank. Clearing
                        it here still works — unbinding needs no proof. */}
                    <Input
                      value={editWallet}
                      onChange={(e) => setEditWallet(e.target.value.trim())}
                      readOnly={!!editWallet}
                      placeholder="Connect a wallet in the $XRGE bank"
                      maxLength={42}
                      className="h-8 font-mono-share text-xs bg-input/50 read-only:opacity-70 read-only:cursor-not-allowed"
                    />
                    <span className="font-mono-share text-[8px] text-muted-foreground/50">
                      {editWallet
                        ? "Receives instant XRGE payouts from locked content · clear this field to unbind"
                        : "Connect & verify in the $XRGE bank to set a payout wallet"}
                    </span>
                  </div>
                  <div>
                    <label className="font-mono-share text-[10px] text-muted-foreground flex items-center gap-1">
                      <LinkIcon className="w-3 h-3" /> SOCIAL LINKS
                    </label>
                    <div className="space-y-1.5 mt-1">
                      {SOCIAL_KEYS.map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="font-mono-share text-[9px] text-muted-foreground w-16 shrink-0">{SOCIAL_META[k].label}</span>
                          <Input
                            value={editSocials[k] || ""}
                            onChange={(e) => setEditSocials((s) => ({ ...s, [k]: e.target.value }))}
                            placeholder={SOCIAL_META[k].placeholder}
                            maxLength={300}
                            className="h-7 font-mono-share text-xs bg-input/50"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSave} disabled={saving} className="font-mono-share text-[10px]">
                      <Check className="w-3 h-3 mr-1" /> {saving ? "SAVING..." : "SAVE"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="font-mono-share text-[10px]">
                      <X className="w-3 h-3 mr-1" /> CANCEL
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="font-orbitron text-lg text-foreground truncate">@{profile.username}</h1>
                    {profile.verified && <VerifiedBadge size="md" />}
                    {profile.holderTier && profile.holderTier !== "none" && (
                      <HolderBadge
                        tier={profile.holderTier}
                        streakDays={profile.holderStreakDays || 0}
                        size="sm"
                        title={
                          profile.holderTotalHeld
                            ? `${Math.floor(profile.holderTotalHeld).toLocaleString()} XRGE held${
                                profile.holderStreakDays ? ` · ${profile.holderStreakDays}-day streak` : ""
                              }`
                            : undefined
                        }
                      />
                    )}
                    {profile.isBanned && (
                      <span className="px-1.5 py-0.5 bg-destructive/20 text-destructive font-mono-share text-[9px] rounded tracking-wider" title={profile.banReason || undefined}>
                        BANNED
                      </span>
                    )}
                    {profile.isOwn && (
                      <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-primary transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {profile.bio && <p className="font-mono-share text-xs text-muted-foreground mt-1">{profile.bio}</p>}
                  {profile.socials && Object.keys(profile.socials).some((k) => profile.socials![k]) && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {SOCIAL_KEYS.filter((k) => profile.socials?.[k]).map((k) => (
                        <a
                          key={k}
                          href={normalizeUrl(profile.socials![k])}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border/50 bg-card/40 hover:border-primary/60 hover:text-primary transition-colors font-mono-share text-[10px] text-muted-foreground"
                        >
                          {k === "instagram" ? <Instagram className="w-3 h-3" /> : <LinkIcon className="w-3 h-3" />}
                          {SOCIAL_META[k].label}
                        </a>
                      ))}
                    </div>
                  )}
                  {!editing && profile.walletTruncated && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <Wallet className="w-3 h-3 text-primary/50" />
                      <span className="font-mono-share text-[10px] text-primary/60">{profile.walletTruncated}</span>
                      <span className="font-mono-share text-[8px] text-muted-foreground/40">BASE</span>
                    </div>
                  )}
                  {profile.isOwn && !profile.verified && (
                    <button
                      onClick={() => setVerifyOpen(true)}
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/40 bg-primary/10 hover:bg-primary/20 hover:border-primary/70 transition-colors font-mono-share text-[10px] text-primary tracking-widest shadow-[0_0_12px_hsl(var(--primary)/0.25)]"
                    >
                      <BadgeCheck className="w-3 h-3" /> GET VERIFIED
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Follow / Ban buttons */}
            {!profile.isOwn && (
              <div className="flex flex-col gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant={profile.isFollowing ? "outline" : "default"}
                  onClick={handleFollow}
                  disabled={followLoading}
                  className="font-mono-share text-[10px]"
                >
                  {profile.isFollowing ? (
                    <><UserMinus className="w-3 h-3 mr-1" /> UNFOLLOW</>
                  ) : (
                    <><UserPlus className="w-3 h-3 mr-1" /> FOLLOW</>
                  )}
                </Button>
                {user && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="font-mono-share text-[10px]"
                    onClick={() => startDm()}
                    disabled={dmLoading}
                  >
                    <Mail className="w-3 h-3 mr-1" /> {dmLoading ? "…" : "MESSAGE"}
                  </Button>
                )}
                {profile.personaChatCharacterId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="font-mono-share text-[10px]"
                    onClick={() => navigate(`/characters?chat=${encodeURIComponent(profile.personaChatCharacterId!)}`)}
                  >
                    <MessageSquare className="w-3 h-3 mr-1" /> AI CHAT
                  </Button>
                )}
                {(user?.is_admin || user?.is_feed_mod) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={banLoading}
                    className="font-mono-share text-[10px]"
                    onClick={async () => {
                      const duration = prompt("Ban duration (1h, 24h, 7d, 30d, or leave empty for permanent):", "24h");
                      if (duration === null) return;
                      const reason = prompt("Ban reason:", "Violation of community guidelines");
                      if (reason === null) return;
                      const validDurations = ["1h", "24h", "7d", "30d", ""];
                      const d = duration.trim().toLowerCase();
                      if (!validDurations.includes(d)) {
                        toast({ title: "Invalid duration. Use 1h, 24h, 7d, 30d, or empty for permanent.", variant: "destructive" });
                        return;
                      }
                      setBanLoading(true);
                      try {
                        await apiFetch("/admin", {
                          method: "POST",
                          body: { action: "ban-user", userId: profile.userId, reason, duration: d || undefined },
                        });
                        toast({ title: `@${profile.username} has been banned${d ? ` for ${d}` : " permanently"}` });
                      } catch (err: any) {
                        toast({ title: err.message, variant: "destructive" });
                      } finally {
                        setBanLoading(false);
                      }
                    }}
                  >
                    <Ban className="w-3 h-3 mr-1" /> BAN
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="flex gap-6 pt-2 border-t border-border/30">
            {[
              { label: "POSTS", value: profile.postCount },
              { label: "FOLLOWERS", value: profile.followers },
              { label: "FOLLOWING", value: profile.following },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-orbitron text-sm text-foreground">{s.value}</div>
                <div className="font-mono-share text-[9px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Earnings (own profile only) */}
        {profile.isOwn && <EarningsPanel />}

        {profile.isOwn && <CreatorPersonaChatPanel />}

        {/* Admin: replace this creator's persona character photo */}
        {!profile.isOwn && user?.is_admin && profile.officialCharacterId && (
          <div className="bg-card/60 border border-border/40 rounded-lg p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded overflow-hidden bg-muted/30 shrink-0 border border-border/40">
              {profile.avatarUrl && <img src={profile.avatarUrl} alt="persona" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-orbitron text-[11px] text-foreground tracking-wider">PERSONA PHOTO</div>
              <div className="font-mono-share text-[9px] text-muted-foreground">Admin: replace this creator's chat character photo</div>
            </div>
            <input
              ref={personaPhotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePersonaPhoto}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => personaPhotoInputRef.current?.click()}
              disabled={personaPhotoUploading}
              className="font-mono-share text-[10px] gap-1.5 h-8 shrink-0"
            >
              {personaPhotoUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
              {personaPhotoUploading ? "UPLOADING…" : "CHANGE PHOTO"}
            </Button>
          </div>
        )}

        {/* Earn — only on your own profile; nobody needs a referral pitch while
            looking at someone else's page. */}
        {profile.isOwn && <EarnPromoBanner variant="card" />}

        {/* Admin inspector (admins viewing other users) */}
        {!profile.isOwn && user?.is_admin && <AdminUserPanel userId={profile.userId} />}

        {/* Gallery */}
        <div>
          <h2 className="font-orbitron text-xs text-muted-foreground mb-3 tracking-widest">POSTS</h2>
          {posts.length === 0 ? (
            <p className="text-center font-mono-share text-xs text-muted-foreground py-8">No posts yet</p>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} onUpdate={fetchProfile} />
              ))}
            </div>
          )}
        </div>
      </div>
      <VerificationDialog open={verifyOpen} onOpenChange={setVerifyOpen} />
      <ProfileMobileChrome />
    </CyberLayout>
  );
};

const ProfileMobileChrome: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [storeOpen, setStoreOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  return (
    <>
      <MobileCreditsPill onOpenStore={() => setStoreOpen(true)} />
      <MobileBottomNav
        isAuthenticated={isAuthenticated}
        onOpenStore={() => setStoreOpen(true)}
        onOpenSettings={() => setPrefsOpen(true)}
      />
      <StoreOverlay open={storeOpen} onOpenChange={setStoreOpen} />
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
    </>
  );
};

export default ProfilePage;
