import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import CyberLayout from "@/components/CyberLayout";
import PostCard from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserPlus, UserMinus, Edit2, Check, X, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Profile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  bio: string;
  createdAt: string;
  followers: number;
  following: number;
  postCount: number;
  isOwn: boolean;
  isFollowing: boolean;
}

interface FeedPost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  imageUrl: string | null;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
  userReacted: boolean;
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
  const [saving, setSaving] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const query = username ? `?username=${username}` : "";
      const data = await apiFetch<Profile>(`/profile${query}`);
      setProfile(data);
      setEditUsername(data.username);
      setEditBio(data.bio || "");

      // Fetch user posts
      const feed = await apiFetch<{ posts: FeedPost[] }>(`/feed?userId=${data.userId}`);
      setPosts(feed.posts);
    } catch {
      toast({ title: "Profile not found", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [username, toast]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/");
      return;
    }
    fetchProfile();
  }, [isAuthenticated, fetchProfile, navigate]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch("/profile", {
        method: "PUT",
        body: { username: editUsername, bio: editBio },
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
          <div className="font-mono-share text-muted-foreground animate-pulse">LOADING PROFILE...</div>
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
            <Avatar className="w-16 h-16 border-2 border-primary/30">
              <AvatarFallback className="bg-primary/10 text-primary font-orbitron text-lg">
                {profile.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

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
                  <div className="flex items-center gap-2">
                    <h1 className="font-orbitron text-lg text-foreground truncate">@{profile.username}</h1>
                    {profile.isOwn && (
                      <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-primary transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {profile.bio && <p className="font-mono-share text-xs text-muted-foreground mt-1">{profile.bio}</p>}
                </>
              )}
            </div>

            {/* Follow button */}
            {!profile.isOwn && (
              <Button
                size="sm"
                variant={profile.isFollowing ? "outline" : "default"}
                onClick={handleFollow}
                disabled={followLoading}
                className="font-mono-share text-[10px] shrink-0"
              >
                {profile.isFollowing ? (
                  <><UserMinus className="w-3 h-3 mr-1" /> UNFOLLOW</>
                ) : (
                  <><UserPlus className="w-3 h-3 mr-1" /> FOLLOW</>
                )}
              </Button>
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
    </CyberLayout>
  );
};

export default ProfilePage;
