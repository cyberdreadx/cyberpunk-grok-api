import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, Users, Gift, DollarSign, Share2, Link2, ArrowLeft, Trophy, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import CyberLayout from "@/components/CyberLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const SITE_URL = "https://grok.gallery";

interface ReferralStats {
  code: string | null;
  totalReferred: number;
  totalVerified: number;
  totalPurchased: number;
  totalRewarded: number;
  totalSubscribed?: number;
  creditsEarned: number;
  freeMonthsEarned?: number;
}

export default function ReferralPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) { setLoading(false); return; }
    try {
      // Get or generate referral code
      const codeRes = await apiFetch<{ code: string }>("/referral", { method: "POST", body: { action: "get-code" } });
      setCode(codeRes.code);

      // Get stats
      const statsRes = await apiFetch<ReferralStats>("/referral", { method: "POST", body: { action: "stats" } });
      setStats(statsRes);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const referralLink = code ? `${SITE_URL}/?ref=${code}` : "";

  const handleCopy = useCallback(() => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({ title: "Link copied!", description: "Share it with friends to earn credits." });
    setTimeout(() => setCopied(false), 2000);
  }, [referralLink, toast]);

  const handleShare = useCallback(() => {
    if (!referralLink) return;
    if (navigator.share) {
      navigator.share({ title: "Join Grok Gallery", text: "Sign up with my link and get 3 free credits!", url: referralLink });
    } else {
      handleCopy();
    }
  }, [referralLink, handleCopy]);

  const tiers = [
    { label: "Friend signs up", you: "—", friend: "+3 credits", icon: Users },
    { label: "Friend verifies email", you: "—", friend: "—", icon: Check },
    { label: "Friend makes 1st purchase", you: "+10 credits", friend: "+5 bonus", icon: Gift },
    { label: "Friend subscribes (any plan)", you: "+1 FREE MONTH", friend: "—", icon: Trophy },
  ];

  return (
    <CyberLayout>
      <div className="min-h-screen px-4 py-6 max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="text-muted-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold font-[Orbitron] text-foreground tracking-wider flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" />
              AFFILIATE PROGRAM
            </h1>
            <p className="text-xs text-muted-foreground">Invite friends, earn credits</p>
          </div>
        </div>

        {!isAuthenticated ? (
          <Card className="p-6 text-center space-y-4 border-border bg-card">
            <Users className="w-12 h-12 mx-auto text-primary opacity-60" />
            <p className="text-muted-foreground text-sm">Sign in to access the referral program</p>
            <Button onClick={() => navigate("/")} className="bg-primary text-primary-foreground font-semibold">
              Sign In
            </Button>
          </Card>
        ) : loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-24 rounded bg-muted animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-2">
              <StatCard icon={Users} label="Invited" value={stats?.totalReferred ?? 0} color="text-primary" />
              <StatCard icon={DollarSign} label="Bought" value={stats?.totalPurchased ?? 0} color="text-secondary" />
              <StatCard icon={Sparkles} label="Credits" value={`+${stats?.creditsEarned ?? 0}`} color="text-accent" />
              <StatCard icon={Trophy} label="Free Mo" value={`${stats?.freeMonthsEarned ?? 0}`} color="text-green-400" />
            </div>

            {/* Referral Link */}
            <Card className="p-4 border-border bg-card space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Link2 className="w-4 h-4 text-primary" />
                Your Referral Link
              </div>
              <div className="flex gap-2">
                <div className="flex-1 bg-muted rounded px-3 py-2 text-xs text-muted-foreground font-mono truncate border border-border">
                  {referralLink || "Generating..."}
                </div>
                <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0 border-border">
                  {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <Button onClick={handleShare} className="w-full bg-primary text-primary-foreground font-semibold gap-2">
                <Share2 className="w-4 h-4" /> Invite Friends
              </Button>
            </Card>

            {/* How it works */}
            <Card className="p-4 border-border bg-card space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Gift className="w-4 h-4 text-secondary" />
                How It Works
              </h2>
              <div className="space-y-0">
                {tiers.map((tier, i) => (
                  <div key={i} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{tier.label}</p>
                      <div className="flex gap-3 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">You: <span className="text-primary">{tier.you}</span></span>
                        <span className="text-[10px] text-muted-foreground">Friend: <span className="text-secondary">{tier.friend}</span></span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Referral History */}
            <Card className="p-4 border-border bg-card space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Referral Breakdown</h2>
              <div className="space-y-2">
                <Row label="Total Invited" value={stats?.totalReferred ?? 0} />
                <Row label="Email Verified" value={stats?.totalVerified ?? 0} />
                <Row label="Made a Purchase" value={stats?.totalPurchased ?? 0} />
                <Row label="Subscribed" value={stats?.totalSubscribed ?? 0} />
                <Row label="Rewards Claimed" value={stats?.totalRewarded ?? 0} />
                <div className="border-t border-border pt-2 flex justify-between text-sm font-bold">
                  <span className="text-foreground">Credits Earned</span>
                  <span className="text-primary">+{stats?.creditsEarned ?? 0}</span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-foreground">Free Months Earned</span>
                  <span className="text-green-400">{stats?.freeMonthsEarned ?? 0}</span>
                </div>
                <p className="text-[10px] text-muted-foreground/70 pt-1 leading-snug">
                  Free months are auto-applied as account credit toward your next subscription renewal.
                </p>
              </div>
            </Card>
          </>
        )}
      </div>
    </CyberLayout>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <Card className="p-3 text-center border-border bg-card">
      <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
      <div className="text-lg font-bold text-foreground font-[Orbitron]">{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
