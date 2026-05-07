import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Sparkles, DollarSign, ShieldCheck, Globe2, ChevronRight, Check, Upload, X, ImagePlus, AlertCircle } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import CyberLayout from "@/components/CyberLayout";
import GlitchText from "@/components/GlitchText";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiUrl } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface FormState {
  email: string;
  handle: string;
  display_name: string;
  country: string;
  age_confirmed: boolean;
  socials: { instagram: string; x: string; tiktok: string; onlyfans: string; other: string };
  pitch: string;
  niche: string;
  languages: string;
  payout_pref: "stripe" | "xrge";
}

const empty: FormState = {
  email: "",
  handle: "",
  display_name: "",
  country: "",
  age_confirmed: false,
  socials: { instagram: "", x: "", tiktok: "", onlyfans: "", other: "" },
  pitch: "",
  niche: "",
  languages: "",
  payout_pref: "stripe",
};

const STEPS = ["Identity", "Socials", "Persona", "Photos", "Payout", "Submit"] as const;

// Photo upload constraints
const MAX_PHOTOS = 5;
const MIN_PHOTOS_RECOMMENDED = 3;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

type PhotoStatus = "pending" | "uploading" | "done" | "error";
interface PhotoItem {
  id: string;
  file: File;
  previewUrl: string;
  status: PhotoStatus;
  progress: number; // 0..100
  uploadedUrl?: string;
  error?: string;
}

export default function ApplyPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(empty);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [subs, setSubs] = useState(50);
  const [ppv, setPpv] = useState(20);

  useEffect(() => {
    if (user?.email && !form.email) setForm((f) => ({ ...f, email: user.email }));
  }, [user, form.email]);

  const projected = useMemo(() => {
    const subPrice = 9.99;
    const ppvPrice = 5;
    const gross = subs * subPrice + ppv * ppvPrice;
    const creatorCut = gross * 0.75;
    return { gross, creatorCut };
  }, [subs, ppv]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const updateSocial = (k: keyof FormState["socials"], v: string) =>
    setForm((f) => ({ ...f, socials: { ...f.socials, [k]: v } }));

  const canNext = () => {
    if (step === 0) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
      && /^[a-zA-Z0-9_]{3,24}$/.test(form.handle)
      && form.display_name.trim().length >= 2
      && form.age_confirmed;
    if (step === 2) return form.pitch.trim().length >= 30;
    return true;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await apiFetch("/creator-applications", { method: "POST", body: form, auth: !!user });
      setDone(true);
    } catch (e: any) {
      toast({ title: "Submission failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CyberLayout>
      <main className="min-h-screen text-foreground">
        {/* Hero */}
        <section className="relative px-4 sm:px-8 pt-10 pb-12 max-w-6xl mx-auto">
          <div className="space-y-4">
            <div className="inline-block px-2 py-1 border border-secondary/40 rounded font-mono-share text-[10px] tracking-widest text-secondary">
              GLTCH // CREATOR PROGRAM
            </div>
            <h1 className="font-orbitron text-3xl sm:text-5xl tracking-tight">
              <GlitchText text="GET PAID TO BE THE FACE OF AN AI CHARACTER" />
            </h1>
            <p className="font-mono-share text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Featured models power the chatbots, stories, and PPV drops on GLTCH. Keep <span className="text-secondary">75%</span> of every sub, unlock, and tip. Get paid in USD or XRGE — your choice.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <a href="#apply">
                <Button size="lg" className="font-orbitron tracking-wider">
                  APPLY NOW <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </a>
              <Link to="/creators">
                <Button size="lg" variant="outline" className="font-orbitron tracking-wider">
                  BROWSE CREATORS
                </Button>
              </Link>
            </div>
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-10">
            {[
              { k: "75/20/5", v: "Revenue split" },
              { k: "$25", v: "USD payout min" },
              { k: "$1", v: "XRGE instant min" },
              { k: "0%", v: "Exclusivity" },
            ].map((s) => (
              <div key={s.v} className="border border-border/40 bg-card/40 backdrop-blur-sm rounded-lg p-3">
                <div className="font-orbitron text-lg sm:text-2xl text-secondary">{s.k}</div>
                <div className="font-mono-share text-[10px] uppercase tracking-wider text-muted-foreground">{s.v}</div>
              </div>
            ))}
          </div>
        </section>

        {/* What you get */}
        <section className="px-4 sm:px-8 py-10 max-w-6xl mx-auto">
          <h2 className="font-orbitron text-xs tracking-widest text-secondary/80 mb-4">// WHAT YOU GET</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { i: Sparkles, t: "Your own AI persona", d: "Your likeness becomes a Character users pay to chat with — flirt, stories, photos." },
              { i: DollarSign, t: "Subs, PPV & tips", d: "Set sub price, lock posts, accept tips. Cash, credits, or XRGE." },
              { i: ShieldCheck, t: "Verified badge", d: "ID-verified creators get a badge, profile boost, and access to monetization." },
              { i: Globe2, t: "Worldwide payouts", d: "Stripe Connect for USD (1099-K), or instant XRGE conversion to your wallet." },
            ].map(({ i: Icon, t, d }) => (
              <div key={t} className="border border-border/40 bg-card/30 rounded-lg p-4 space-y-2">
                <Icon className="w-5 h-5 text-secondary" />
                <div className="font-orbitron text-xs tracking-wider">{t}</div>
                <div className="font-mono-share text-[11px] text-muted-foreground leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="px-4 sm:px-8 py-10 max-w-6xl mx-auto">
          <h2 className="font-orbitron text-xs tracking-widest text-secondary/80 mb-4">// HOW IT WORKS</h2>
          <ol className="grid sm:grid-cols-4 gap-3">
            {[
              "Submit your application",
              "Pass ID + age verification",
              "Upload reference photos & persona",
              "Go live & start earning",
            ].map((s, idx) => (
              <li key={s} className="border border-border/40 rounded-lg p-4 bg-card/30">
                <div className="font-orbitron text-secondary text-2xl">0{idx + 1}</div>
                <div className="font-mono-share text-[12px] text-foreground mt-1">{s}</div>
              </li>
            ))}
          </ol>
        </section>

        {/* Earnings calc */}
        <section className="px-4 sm:px-8 py-10 max-w-3xl mx-auto">
          <h2 className="font-orbitron text-xs tracking-widest text-secondary/80 mb-4">// EARNINGS CALCULATOR</h2>
          <div className="border border-border/40 rounded-lg p-5 bg-card/40 space-y-4">
            <div>
              <Label className="font-mono-share text-[11px]">Monthly subscribers: <span className="text-secondary">{subs}</span></Label>
              <input type="range" min={0} max={1000} value={subs} onChange={(e) => setSubs(+e.target.value)} className="w-full accent-[hsl(var(--secondary))]" />
            </div>
            <div>
              <Label className="font-mono-share text-[11px]">PPV unlocks / month: <span className="text-secondary">{ppv}</span></Label>
              <input type="range" min={0} max={500} value={ppv} onChange={(e) => setPpv(+e.target.value)} className="w-full accent-[hsl(var(--secondary))]" />
            </div>
            <div className="pt-2 border-t border-border/40 flex justify-between font-mono-share text-sm">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Gross</div>
                <div className="text-foreground">${projected.gross.toFixed(0)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider">You keep (75%)</div>
                <div className="text-secondary text-xl font-orbitron">${projected.creatorCut.toFixed(0)}/mo</div>
              </div>
            </div>
          </div>
        </section>

        {/* Application form */}
        <section id="apply" className="px-4 sm:px-8 py-12 max-w-2xl mx-auto">
          <h2 className="font-orbitron text-xl sm:text-2xl mb-2">APPLY</h2>
          <p className="font-mono-share text-[11px] text-muted-foreground mb-6">
            Takes ~3 minutes. Admins review within 48h.
          </p>

          {done ? (
            <div className="border border-secondary/40 bg-secondary/5 rounded-lg p-6 text-center space-y-3">
              <Check className="w-10 h-10 text-secondary mx-auto" />
              <h3 className="font-orbitron text-lg">APPLICATION RECEIVED</h3>
              <p className="font-mono-share text-[12px] text-muted-foreground">
                We'll email <span className="text-foreground">{form.email}</span> with the next steps within 48 hours. If approved, you'll be invited to complete ID verification and set up your monetization.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <Link to="/apply/status"><Button size="sm">View status</Button></Link>
                <Link to="/"><Button variant="outline" size="sm">Back to feed</Button></Link>
              </div>
            </div>
          ) : (
            <div className="border border-border/40 rounded-lg p-5 sm:p-6 bg-card/40 space-y-5">
              {/* Step indicator */}
              <div className="flex items-center justify-between gap-1">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex-1 flex items-center gap-1">
                    <div className={`h-1 flex-1 rounded ${i <= step ? "bg-secondary" : "bg-border/40"}`} />
                  </div>
                ))}
              </div>
              <div className="font-mono-share text-[10px] tracking-widest text-muted-foreground">
                STEP {step + 1} / {STEPS.length} — {STEPS[step]}
              </div>

              {step === 0 && (
                <div className="space-y-3">
                  <div>
                    <Label className="font-mono-share text-[11px]">Email *</Label>
                    <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="you@example.com" />
                  </div>
                  <div>
                    <Label className="font-mono-share text-[11px]">Handle * (letters/numbers/underscore, 3–24)</Label>
                    <Input value={form.handle} onChange={(e) => update("handle", e.target.value)} placeholder="luna_void" />
                  </div>
                  <div>
                    <Label className="font-mono-share text-[11px]">Display name *</Label>
                    <Input value={form.display_name} onChange={(e) => update("display_name", e.target.value)} placeholder="Luna Void" />
                  </div>
                  <div>
                    <Label className="font-mono-share text-[11px]">Country</Label>
                    <Input value={form.country} onChange={(e) => update("country", e.target.value)} placeholder="US" />
                  </div>
                  <label className="flex items-start gap-2 pt-1">
                    <Checkbox checked={form.age_confirmed} onCheckedChange={(v) => update("age_confirmed", !!v)} />
                    <span className="font-mono-share text-[11px] text-muted-foreground leading-relaxed">
                      I confirm I am 18+ and will pass ID verification before going live.
                    </span>
                  </label>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-3">
                  <p className="font-mono-share text-[11px] text-muted-foreground">
                    Add at least one social so we can verify it's really you. Public profiles only.
                  </p>
                  {(["instagram", "x", "tiktok", "onlyfans", "other"] as const).map((k) => (
                    <div key={k}>
                      <Label className="font-mono-share text-[11px] uppercase">{k}</Label>
                      <Input value={form.socials[k]} onChange={(e) => updateSocial(k, e.target.value)} placeholder={`https://...`} />
                    </div>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <div>
                    <Label className="font-mono-share text-[11px]">Pitch your persona * (min 30 chars)</Label>
                    <Textarea
                      rows={5}
                      value={form.pitch}
                      onChange={(e) => update("pitch", e.target.value)}
                      placeholder="Describe your vibe, niche, what kind of character you'd want to bring to life…"
                    />
                  </div>
                  <div>
                    <Label className="font-mono-share text-[11px]">Niche / category</Label>
                    <Input value={form.niche} onChange={(e) => update("niche", e.target.value)} placeholder="cyberpunk, goth, gamer girl…" />
                  </div>
                  <div>
                    <Label className="font-mono-share text-[11px]">Languages spoken</Label>
                    <Input value={form.languages} onChange={(e) => update("languages", e.target.value)} placeholder="English, Spanish" />
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <Label className="font-mono-share text-[11px]">Preferred payout method</Label>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {(["stripe", "xrge"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => update("payout_pref", p)}
                        className={`text-left p-3 rounded-lg border ${form.payout_pref === p ? "border-secondary bg-secondary/10" : "border-border/40 bg-card/30"}`}
                      >
                        <div className="font-orbitron text-xs">{p === "stripe" ? "STRIPE (USD)" : "XRGE (CRYPTO)"}</div>
                        <div className="font-mono-share text-[10px] text-muted-foreground mt-1">
                          {p === "stripe" ? "Min $25 · manual review · 1099-K" : "Min $1 · instant to in-app bank"}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3 font-mono-share text-[11px] text-muted-foreground">
                  <p>Review and submit. By submitting you agree to the creator terms, content rules, and acknowledge that approval requires ID + age verification.</p>
                  <div className="border border-border/40 rounded p-3 space-y-1 text-foreground">
                    <div><span className="text-muted-foreground">Handle:</span> @{form.handle}</div>
                    <div><span className="text-muted-foreground">Email:</span> {form.email}</div>
                    <div><span className="text-muted-foreground">Payout:</span> {form.payout_pref}</div>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
                    Next <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                ) : (
                  <Button disabled={submitting || !canNext()} onClick={submit}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit application"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </CyberLayout>
  );
}
