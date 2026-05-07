import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Sparkles, DollarSign, ShieldCheck, Globe2, ChevronRight, Check, Upload, X, ImagePlus, AlertCircle, Crop as CropIcon, Star } from "lucide-react";
import { upload } from "@vercel/blob/client";
import CropDialog from "@/components/CropDialog";
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

  // ── Photo upload state ────────────────────────────────────────
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const photosUploading = photos.some((p) => p.status === "uploading");
  const photosDone = photos.filter((p) => p.status === "done");
  const photosErrored = photos.filter((p) => p.status === "error");
  const cropTarget = photos.find((p) => p.id === cropTargetId) || null;

  const applyCrop = async (id: string, blob: Blob) => {
    const orig = photos.find((p) => p.id === id);
    if (!orig) return;
    const ext = blob.type === "image/png" ? "png" : "jpg";
    const baseName = orig.file.name.replace(/\.[^.]+$/, "");
    const file = new File([blob], `${baseName}-cropped.${ext}`, { type: blob.type });
    const previewUrl = URL.createObjectURL(blob);
    URL.revokeObjectURL(orig.previewUrl);
    const updated: PhotoItem = { ...orig, file, previewUrl, status: "pending", progress: 0, uploadedUrl: undefined, error: undefined };
    setPhotos((prev) => prev.map((p) => (p.id === id ? updated : p)));
    void uploadOne(updated);
  };

  // Revoke object URLs on unmount/replace
  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateFile = (f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type)) return "Only PNG, JPEG, or WebP";
    if (f.size > MAX_PHOTO_BYTES) return `Max ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)}MB`;
    if (f.size < 1024) return "File too small";
    return null;
  };

  const uploadOne = async (item: PhotoItem) => {
    setPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, status: "uploading", progress: 5, error: undefined } : p));
    try {
      if (!user) throw new Error("Sign in required to upload photos");
      const authToken = localStorage.getItem("auth-token") || "";
      if (!authToken) throw new Error("Not authenticated");
      const ext = item.file.type === "image/png" ? "png" : item.file.type === "image/webp" ? "webp" : "jpg";
      const path = `creator-applications/sample.${ext}`;
      const result = await upload(path, item.file, {
        access: "public",
        handleUploadUrl: `${apiUrl("")}/blob-upload`,
        clientPayload: authToken,
        onUploadProgress: ({ percentage }) => {
          setPhotos((prev) => prev.map((p) =>
            p.id === item.id ? { ...p, progress: Math.max(5, Math.min(99, percentage)) } : p
          ));
        },
      });
      setPhotos((prev) => prev.map((p) =>
        p.id === item.id ? { ...p, status: "done", progress: 100, uploadedUrl: result.url } : p
      ));
    } catch (e: any) {
      setPhotos((prev) => prev.map((p) =>
        p.id === item.id ? { ...p, status: "error", error: e?.message || "Upload failed" } : p
      ));
    }
  };

  const addFiles = (files: FileList | File[]) => {
    if (!user) {
      toast({ title: "Sign in required", description: "Create an account before uploading photos.", variant: "destructive" });
      return;
    }
    const incoming = Array.from(files);
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      toast({ title: "Photo limit reached", description: `Max ${MAX_PHOTOS} photos.`, variant: "destructive" });
      return;
    }
    const slice = incoming.slice(0, remaining);
    const next: PhotoItem[] = [];
    for (const f of slice) {
      const err = validateFile(f);
      if (err) {
        toast({ title: `Skipped ${f.name}`, description: err, variant: "destructive" });
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        status: "pending",
        progress: 0,
      });
    }
    if (next.length === 0) return;
    setPhotos((prev) => [...prev, ...next]);
    next.forEach((item) => { void uploadOne(item); });
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const retryPhoto = (id: string) => {
    const item = photos.find((p) => p.id === id);
    if (item) void uploadOne(item);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const canNext = () => {
    if (step === 0) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
      && /^[a-zA-Z0-9_]{3,24}$/.test(form.handle)
      && form.display_name.trim().length >= 2
      && form.age_confirmed;
    if (step === 2) return form.pitch.trim().length >= 30;
    if (step === 3) return !photosUploading && photosDone.length >= 1 && photosErrored.length === 0;
    return true;
  };

  const submit = async () => {
    if (photosUploading) {
      toast({ title: "Uploads in progress", description: "Wait for photos to finish." });
      return;
    }
    setSubmitting(true);
    try {
      const sample_urls = photosDone.map((p) => p.uploadedUrl!).filter(Boolean);
      await apiFetch("/creator-applications", {
        method: "POST",
        body: { ...form, sample_urls },
        auth: !!user,
      });
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
                  <p className="font-mono-share text-[11px] text-muted-foreground leading-relaxed">
                    Upload {MIN_PHOTOS_RECOMMENDED}–{MAX_PHOTOS} reference photos so we can confirm identity and build your AI persona. Clear face shots, varied angles. PNG/JPEG/WebP, max 8MB each.
                  </p>
                  {!user && (
                    <div className="flex items-start gap-2 border border-amber-400/40 bg-amber-400/5 rounded p-2 font-mono-share text-[10px] text-amber-300">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      Sign in to upload — uploads are tied to your account.
                    </div>
                  )}

                  {/* Dropzone */}
                  <div
                    onDrop={onDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                      photos.length >= MAX_PHOTOS || !user
                        ? "border-border/30 bg-muted/10 cursor-not-allowed opacity-60"
                        : "border-secondary/40 bg-secondary/5 hover:border-secondary"
                    }`}
                  >
                    <ImagePlus className="w-7 h-7 mx-auto text-secondary mb-2" />
                    <div className="font-orbitron text-xs">
                      {photos.length >= MAX_PHOTOS ? "PHOTO LIMIT REACHED" : "DROP PHOTOS OR CLICK TO BROWSE"}
                    </div>
                    <div className="font-mono-share text-[10px] text-muted-foreground mt-1">
                      {photos.length} / {MAX_PHOTOS} uploaded
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_TYPES.join(",")}
                      multiple
                      hidden
                      disabled={!user || photos.length >= MAX_PHOTOS}
                      onChange={(e) => {
                        if (e.target.files?.length) addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  {/* Previews */}
                  {photos.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {photos.map((p) => (
                        <div key={p.id} className="relative group border border-border/40 rounded overflow-hidden bg-background/40 aspect-square">
                          <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                          {/* Status overlay */}
                          {p.status === "uploading" && (
                            <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex flex-col items-center justify-center gap-1">
                              <Loader2 className="w-4 h-4 animate-spin text-secondary" />
                              <div className="font-mono-share text-[9px] text-secondary">{Math.round(p.progress)}%</div>
                            </div>
                          )}
                          {p.status === "done" && (
                            <div className="absolute top-1 left-1 bg-green-500/90 rounded-full p-0.5">
                              <Check className="w-3 h-3 text-background" />
                            </div>
                          )}
                          {p.status === "error" && (
                            <div className="absolute inset-0 bg-destructive/80 flex flex-col items-center justify-center gap-1 p-1 text-center">
                              <AlertCircle className="w-4 h-4 text-background" />
                              <div className="font-mono-share text-[8px] text-background line-clamp-2">{p.error}</div>
                              <button
                                onClick={(e) => { e.stopPropagation(); retryPhoto(p.id); }}
                                className="font-mono-share text-[9px] underline text-background"
                              >
                                Retry
                              </button>
                            </div>
                          )}
                          {/* Progress bar */}
                          {p.status === "uploading" && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-background/60">
                              <div className="h-full bg-secondary transition-all" style={{ width: `${p.progress}%` }} />
                            </div>
                          )}
                          {/* Actions */}
                          <div className="absolute top-1 right-1 flex gap-1">
                            {p.status === "done" && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setCropTargetId(p.id); }}
                                className="bg-background/80 hover:bg-secondary hover:text-background rounded-full p-1 transition-colors"
                                aria-label="Crop"
                                title="Crop"
                              >
                                <CropIcon className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removePhoto(p.id); }}
                              className="bg-background/80 hover:bg-destructive hover:text-background rounded-full p-1 transition-colors"
                              aria-label="Remove"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between font-mono-share text-[10px]">
                    <span className={photosDone.length >= MIN_PHOTOS_RECOMMENDED ? "text-green-400" : "text-muted-foreground"}>
                      {photosDone.length} uploaded · {MIN_PHOTOS_RECOMMENDED} recommended
                    </span>
                    {photosUploading && <span className="text-secondary flex items-center gap-1"><Upload className="w-3 h-3" /> uploading…</span>}
                  </div>
                </div>
              )}

              {step === 4 && (
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

              {step === 5 && (
                <div className="space-y-4 font-mono-share text-[11px] text-muted-foreground">
                  {/* Live preview of /creators grid card */}
                  <div>
                    <div className="font-orbitron text-[10px] tracking-widest text-secondary/80 mb-2">
                      // PREVIEW · HOW YOU'LL APPEAR ON /CREATORS
                    </div>
                    <div className="border border-dashed border-border/40 rounded-lg p-4 bg-background/40">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="border border-border/40 rounded-lg overflow-hidden bg-card/40 hover:border-secondary/60 transition-colors">
                          <div className="aspect-square bg-muted/20 flex items-center justify-center overflow-hidden relative">
                            {photosDone[0]?.uploadedUrl ? (
                              <img
                                src={photosDone[0].uploadedUrl}
                                alt={form.display_name || form.handle || "preview"}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="font-orbitron text-3xl text-muted-foreground/40">
                                {(form.display_name || form.handle || "?").slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="absolute top-1 left-1 font-mono-share text-[8px] tracking-widest px-1.5 py-0.5 rounded bg-background/70 text-secondary border border-secondary/40">
                              VERIFIED SOON
                            </span>
                          </div>
                          <div className="p-3 space-y-1">
                            <div className="flex items-center gap-1 font-orbitron text-xs truncate">
                              {form.display_name || "Display name"}
                              <ShieldCheck className="w-3 h-3 text-secondary/60 shrink-0" />
                            </div>
                            <div className="font-mono-share text-[10px] text-muted-foreground truncate">
                              @{form.handle || "handle"}
                            </div>
                            {form.niche && (
                              <div className="font-mono-share text-[9px] text-secondary/70 truncate">{form.niche}</div>
                            )}
                          </div>
                        </div>
                        <div className="hidden sm:flex flex-col justify-center font-mono-share text-[10px] text-muted-foreground/70 col-span-2">
                          <p className="leading-relaxed">
                            This is exactly how subscribers will discover you in the public directory once approved. The verified badge unlocks after ID + age verification.
                          </p>
                          {photosDone.length === 0 && (
                            <p className="mt-2 text-amber-400/80">No photo uploaded — your card will show an initial placeholder.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <p>Review and submit. By submitting you agree to the creator terms, content rules, and acknowledge that approval requires ID + age verification.</p>
                  <div className="border border-border/40 rounded p-3 space-y-1 text-foreground">
                    <div><span className="text-muted-foreground">Handle:</span> @{form.handle}</div>
                    <div><span className="text-muted-foreground">Email:</span> {form.email}</div>
                    <div><span className="text-muted-foreground">Photos:</span> {photosDone.length} uploaded</div>
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
      {cropTarget && (
        <CropDialog
          open={!!cropTarget}
          imageUrl={cropTarget.previewUrl || cropTarget.uploadedUrl || ""}
          aspect={1}
          onClose={() => setCropTargetId(null)}
          onCropped={(blob) => applyCrop(cropTarget.id, blob)}
        />
      )}
    </CyberLayout>
  );
}
