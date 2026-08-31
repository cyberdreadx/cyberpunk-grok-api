import React, { useState, useCallback } from "react";
import { Copy, Check, Key, Zap, Shield, ArrowLeft, ExternalLink, Play, Loader2, Wand2, Cpu } from "lucide-react";
import { Link } from "react-router-dom";
import CyberLayout from "@/components/CyberLayout";
import GlitchText from "@/components/GlitchText";
import { Button } from "@/components/ui/button";

/**
 * Where the API actually lives. This used to read
 * "https://cyberpunk-grok-api.vercel.app" — a Vercel deployment that has been
 * disabled since April 2026 and answers every path with HTTP 402
 * DEPLOYMENT_DISABLED. Every sample on this page interpolates it, so every
 * sample was a guaranteed failure, and the playground below just reported
 * "API returned non-JSON".
 *
 * api.gltch.app is the API host; grokrunner.gltch.app is the app (Netlify
 * proxies /api/* there to the same backend, so either base works). Keys and
 * credits live on the app, so those links point at APP_URL instead.
 */
const API_BASE = "https://api.gltch.app";
const APP_URL = "https://grokrunner.gltch.app";

function CopyBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="bg-muted/50 border border-primary/10 rounded-lg p-4 overflow-x-auto text-xs font-mono text-foreground leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-primary/10 hover:bg-primary/20 text-primary opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-mono font-bold text-primary tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function ApiPlayground({ baseUrl }: { baseUrl: string }) {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("a cyberpunk cityscape at sunset, neon lights");
  const [engine, setEngine] = useState<"gltch" | "comfy">("gltch");
  const [imageUrl, setImageUrl] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [hd, setHd] = useState(false);
  // "klein" is what the API falls back to when workflow is omitted.
  const [comfyWorkflow, setComfyWorkflow] = useState("klein");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [resultVideo, setResultVideo] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    if (!apiKey.trim()) { setError("Enter your API key first"); return; }
    if (!prompt.trim()) { setError("Enter a prompt"); return; }
    setLoading(true);
    setError(null);
    setResponse(null);
    setResultImages([]);
    setResultVideo(null);

    let url = "";
    let body: Record<string, unknown> = { prompt: prompt.trim() };

    if (engine === "gltch") {
      url = `${baseUrl}/api/v1/gltch`;
      if (!imageUrl.trim()) { setError("GLTCH requires an image_url"); setLoading(false); return; }
      body.image_url = imageUrl.trim();
      body.aspect_ratio = aspectRatio;
      body.hd = hd;
    } else {
      url = `${baseUrl}/api/v1/comfy`;
      body.workflow = comfyWorkflow;
      if (["klein", "wan-video"].includes(comfyWorkflow)) {
        if (!imageUrl.trim()) { setError("This workflow requires an image_url"); setLoading(false); return; }
        body.image_url = imageUrl.trim();
      }
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey.trim() },
        body: JSON.stringify(body),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        setError(`API returned non-JSON (${res.status}). Raw: ${text.slice(0, 200)}`);
        setLoading(false);
        return;
      }

      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));

      if (res.ok) {
        if (data.data) setResultImages(data.data.map((d: { url?: string }) => d.url).filter(Boolean));
        if (data.image_url) setResultImages([data.image_url]);
        if (data.video_url) setResultVideo(data.video_url);
      } else {
        setError(`${res.status}: ${data.error || "Request failed"}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      if (msg.includes("Failed to fetch")) {
        setError("Failed to fetch — check your network connection and try again.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [apiKey, prompt, engine, imageUrl, aspectRatio, hd, comfyWorkflow, baseUrl]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/80 font-mono">
        Test the API directly from your browser. Enter your API key and hit run — credits will be deducted from your account.
      </p>

      {/* API Key */}
      <div className="space-y-1">
        <label className="text-xs font-mono text-muted-foreground flex items-center gap-1.5">
          <Key className="w-3 h-3" /> API KEY
        </label>
        <input
          type="password"
          placeholder="gltch_sk_..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full bg-muted/50 border border-primary/20 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
        />
      </div>

      {/* Engine toggle */}
      <div className="flex gap-2 flex-wrap">
        {([
          { id: "gltch" as const, icon: Wand2, label: "GLTCH" },
          { id: "comfy" as const, icon: Cpu, label: "GLTCH PRO" },
        ]).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setEngine(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
              engine === id
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-muted/30 border-primary/10 text-muted-foreground hover:border-primary/20"
            }`}
          >
            <Icon className="w-3 h-3" /> {label}
          </button>
        ))}
      </div>

      {/* Prompt */}
      <div className="space-y-1">
        <label className="text-xs font-mono text-muted-foreground">PROMPT</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="w-full bg-muted/50 border border-primary/20 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-none"
        />
      </div>

      {/* Image URL (for GLTCH and some ComfyUI workflows) */}
      {(engine === "gltch" || (engine === "comfy" && ["klein", "wan-video"].includes(comfyWorkflow))) && (
        <div className="space-y-1">
          <label className="text-xs font-mono text-muted-foreground">IMAGE URL</label>
          <input
            type="url"
            placeholder="https://example.com/image.jpg"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="w-full bg-muted/50 border border-primary/20 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
        </div>
      )}

      {/* Options */}
      <div className="flex flex-wrap gap-3">
        {engine === "gltch" && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">ASPECT RATIO</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="bg-muted/50 border border-primary/20 rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
              >
                {["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">HD</label>
              <select
                value={hd ? "yes" : "no"}
                onChange={(e) => setHd(e.target.value === "yes")}
                className="bg-muted/50 border border-primary/20 rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="no">Standard (5 cr)</option>
                <option value="yes">HD (7 cr)</option>
              </select>
            </div>
          </>
        )}
        {engine === "comfy" && (
          <div className="space-y-1">
            <label className="text-xs font-mono text-muted-foreground">WORKFLOW</label>
            <select
              value={comfyWorkflow}
              onChange={(e) => setComfyWorkflow(e.target.value)}
              className="bg-muted/50 border border-primary/20 rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="klein">klein edit (3 cr)</option>
              <option value="txt2img">txt2img (3 cr)</option>
              <option value="wan-video">wan-video (15 cr)</option>
            </select>
          </div>
        )}
      </div>

      {/* Run */}
      <button
        onClick={handleRun}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-mono text-xs font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        {loading ? "GENERATING..." : "RUN REQUEST"}
      </button>

      {/* Error */}
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs font-mono text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {resultImages.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {resultImages.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-primary/20 hover:border-primary/40 transition-colors">
              <img src={url} alt={`Generated ${i + 1}`} className="w-full h-auto" />
            </a>
          ))}
        </div>
      )}
      {resultVideo && (
        <video src={resultVideo} controls autoPlay muted className="w-full rounded-lg border border-primary/20" />
      )}

      {/* Raw response */}
      {response && (
        <div className="space-y-1">
          <h4 className="text-xs font-mono font-bold text-muted-foreground">RAW RESPONSE</h4>
          <CopyBlock code={response} language="json" />
        </div>
      )}
    </div>
  );
}

export default function ApiDocs() {
  const baseUrl = API_BASE;

  return (
    <CyberLayout>
      <div className="min-h-screen py-8 px-4 max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-1 font-mono text-xs text-muted-foreground">
              <ArrowLeft className="w-3 h-3" /> BACK
            </Button>
          </Link>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-mono font-bold">
            <GlitchText text="API DOCUMENTATION" />
          </h1>
          <p className="text-sm text-muted-foreground font-mono">
            Edit images and generate video programmatically using the GLTCH and GLTCH PRO engines. Pay with credits from your account.
          </p>
          <p className="text-xs text-muted-foreground/70 font-mono">
            Base URL: <code className="text-primary bg-muted/50 px-1 rounded">{API_BASE}</code>
          </p>
        </div>

        {/* Quick start */}
        <Section title="⚡ QUICK START">
          <ol className="list-decimal list-inside space-y-2 text-sm text-foreground/80 font-mono">
            <li>Sign in at <a href={APP_URL} className="text-primary underline">{APP_URL}</a></li>
            <li>Generate an API key from the <strong className="text-primary">API KEYS</strong> button on the main page</li>
            <li>Use the key in your requests via the <code className="text-primary bg-muted/50 px-1 rounded">X-API-Key</code> header</li>
            <li>Send requests to <code className="text-primary bg-muted/50 px-1 rounded">{API_BASE}</code></li>
          </ol>
        </Section>

        {/* Authentication */}
        <Section title="🔑 AUTHENTICATION">
          <p className="text-sm text-foreground/80 font-mono">
            All API requests require an API key passed in the <code className="text-primary bg-muted/50 px-1 rounded">X-API-Key</code> header.
            Keys start with <code className="text-primary bg-muted/50 px-1 rounded">gltch_sk_</code>.
          </p>
          <CopyBlock code={`curl -H "X-API-Key: gltch_sk_your_key_here" ...`} />
          <div className="flex items-start gap-2 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
            <Shield className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-foreground/70 font-mono">
              Keep your API key secret. Don't expose it in client-side code or public repos.
              If compromised, revoke it immediately from the dashboard.
            </p>
          </div>
        </Section>

        {/* Endpoint */}
        <Section title="📡 ENDPOINTS">
          <div className="space-y-4">
            {/* GLTCH Edit */}
            <div className="border border-primary/20 rounded-lg overflow-hidden">
              <div className="bg-primary/5 px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-0.5 rounded">POST</span>
                <code className="text-sm font-mono text-foreground">/api/v1/gltch</code>
                <span className="text-[10px] font-mono text-muted-foreground ml-auto">GLTCH EDIT</span>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-foreground/80 font-mono">
                  AI-powered image editing. Provide an image URL and a prompt describing the edit.
                </p>
                <div>
                  <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">REQUEST BODY</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-primary/10">
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Parameter</th>
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Type</th>
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Default</th>
                          <th className="text-left py-1.5 text-muted-foreground">Description</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground/80">
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">prompt *</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">—</td>
                          <td className="py-1.5">Edit description (max 5000 chars)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">image_url *</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">—</td>
                          <td className="py-1.5">Public URL of image to edit</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">aspect_ratio</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">1:1</td>
                          <td className="py-1.5">1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-3 text-primary">hd</td>
                          <td className="py-1.5 pr-3">boolean</td>
                          <td className="py-1.5 pr-3">false</td>
                          <td className="py-1.5">HD upscale (5 cr → 7 cr)</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* GLTCH PRO */}
            <div className="border border-primary/20 rounded-lg overflow-hidden">
              <div className="bg-primary/5 px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-0.5 rounded">POST</span>
                <code className="text-sm font-mono text-foreground">/api/v1/comfy</code>
                <span className="text-[10px] font-mono text-muted-foreground ml-auto">GLTCH PRO</span>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-foreground/80 font-mono">
                  Advanced generation pipelines — text-to-image, Flux Klein editing, and WAN video generation via ComfyUI.
                </p>
                <div>
                  <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">REQUEST BODY</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-primary/10">
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Parameter</th>
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Type</th>
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Default</th>
                          <th className="text-left py-1.5 text-muted-foreground">Description</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground/80">
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">prompt *</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">—</td>
                          <td className="py-1.5">Text description (max 5000 chars)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">workflow</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">klein</td>
                          <td className="py-1.5">txt2img, klein, wan-video</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">image_url</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">—</td>
                          <td className="py-1.5">Required for klein and wan-video</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">width / height</td>
                          <td className="py-1.5 pr-3">integer</td>
                          <td className="py-1.5 pr-3">832×1216</td>
                          <td className="py-1.5">Dimensions, 256–2048. wan-video defaults to 832×480 and caps at 1024</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">steps</td>
                          <td className="py-1.5 pr-3">integer</td>
                          <td className="py-1.5 pr-3">20</td>
                          <td className="py-1.5">Sampling steps (1–100)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">cfg</td>
                          <td className="py-1.5 pr-3">number</td>
                          <td className="py-1.5 pr-3">7</td>
                          <td className="py-1.5">Guidance scale (0.1–30)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">checkpoint</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">auto</td>
                          <td className="py-1.5">Model checkpoint (use /api/v1/models to list)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">negative_prompt</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">auto</td>
                          <td className="py-1.5">What to avoid in the output</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">lora</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">—</td>
                          <td className="py-1.5">Optional LoRA model name</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">lora_strength</td>
                          <td className="py-1.5 pr-3">number</td>
                          <td className="py-1.5 pr-3">0.8</td>
                          <td className="py-1.5">LoRA strength (0–2)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-3 text-primary">frame_count</td>
                          <td className="py-1.5 pr-3">integer</td>
                          <td className="py-1.5 pr-3">81</td>
                          <td className="py-1.5">Video frames (17–241, wan-video only)</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">WORKFLOWS & COSTS</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-primary/10">
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Workflow</th>
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Credits</th>
                          <th className="text-left py-1.5 text-muted-foreground">Description</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground/80">
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">klein</td>
                          <td className="py-1.5 pr-3">3–4 cr</td>
                          <td className="py-1.5">Flux Klein image editing, the default (+1 for HD)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">txt2img</td>
                          <td className="py-1.5 pr-3">3 cr</td>
                          <td className="py-1.5">Text-to-image (SD / Flux models)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-3 text-primary">wan-video</td>
                          <td className="py-1.5 pr-3">15 cr</td>
                          <td className="py-1.5">WAN image-to-video (requires image_url)</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Models Discovery */}
            <div className="border border-primary/20 rounded-lg overflow-hidden">
              <div className="bg-primary/5 px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-0.5 rounded">GET</span>
                <code className="text-sm font-mono text-foreground">/api/v1/models</code>
                <span className="text-[10px] font-mono text-muted-foreground ml-auto">DISCOVERY</span>
              </div>
              <div className="p-4 space-y-2">
                <p className="text-sm text-foreground/80 font-mono">
                  List all available engines, models, and their credit costs. Returns available checkpoints for GLTCH PRO.
                </p>
                <CopyBlock code={`curl -H "X-API-Key: gltch_sk_..." ${baseUrl}/api/v1/models`} />
              </div>
            </div>
          </div>
        </Section>
        <Section title="💻 CODE EXAMPLES">
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">cURL — GLTCH Edit</h4>
              <CopyBlock code={`curl -X POST ${baseUrl}/api/v1/gltch \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: gltch_sk_your_key_here" \\
  -d '{
    "prompt": "make it look like a watercolor painting",
    "image_url": "https://example.com/photo.jpg",
    "aspect_ratio": "16:9"
  }'`} />
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">cURL — GLTCH PRO Klein Edit</h4>
              <CopyBlock code={`curl -X POST ${baseUrl}/api/v1/comfy \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: gltch_sk_your_key_here" \\
  -d '{
    "prompt": "cyberpunk style, neon lighting, futuristic",
    "workflow": "klein",
    "image_url": "https://example.com/photo.jpg"
  }'`} />
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">Python — GLTCH PRO WAN Video</h4>
              <CopyBlock language="python" code={`import requests

response = requests.post(
    "${baseUrl}/api/v1/comfy",
    headers={
        "Content-Type": "application/json",
        "X-API-Key": "gltch_sk_your_key_here",
    },
    json={
        "prompt": "girl walking through a neon-lit alley, cinematic",
        "workflow": "wan-video",
        "image_url": "https://example.com/photo.jpg",
        "frame_count": 81,
        "steps": 20,
    },
    timeout=300,  # video generation takes 2-5 minutes
)

data = response.json()
print(data["video_url"])
print(f"Credits used: {data['credits_used']}")`} />
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">JavaScript / Node.js</h4>
              <CopyBlock language="javascript" code={`const response = await fetch("${baseUrl}/api/v1/comfy", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "gltch_sk_your_key_here",
  },
  body: JSON.stringify({
    prompt: "cyberpunk style, neon lighting",
    workflow: "klein",
    image_url: "https://example.com/photo.jpg",
  }),
});

const data = await response.json();
if (!response.ok) throw new Error(\`\${response.status}: \${data.error}\`);

console.log(data.image_url);
console.log(\`Credits used: \${data.credits_used}\`);
console.log(\`Credits remaining: \${data.credits_remaining}\`);`} />
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">cURL — List models &amp; checkpoints</h4>
              <CopyBlock code={`curl -H "X-API-Key: gltch_sk_your_key_here" \\
  ${baseUrl}/api/v1/models`} />
            </div>
          </div>
        </Section>

        {/* Response */}
        <Section title="📦 RESPONSE FORMAT">
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">GLTCH EDIT RESPONSE</h4>
              <CopyBlock language="json" code={`{
  "type": "gltch-edit",
  "image_url": "https://...",
  "seed": 1234567890,
  "hd": false,
  "credits_used": 5,
  "credits_remaining": 141
}`} />
            </div>
            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">GLTCH PRO IMAGE RESPONSE</h4>
              <CopyBlock language="json" code={`{
  "type": "comfy-image",
  "workflow": "klein",
  "image_url": "https://...",
  "seed": 1234567890,
  "credits_used": 3,
  "credits_remaining": 138
}`} />
            </div>
            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">GLTCH PRO VIDEO RESPONSE</h4>
              <CopyBlock language="json" code={`{
  "type": "comfy-video",
  "workflow": "wan-video",
  "video_url": "https://...",
  "seed": 1234567890,
  "credits_used": 15,
  "credits_remaining": 123
}`} />
            </div>
          </div>
        </Section>

        {/* Errors */}
        <Section title="🚨 ERROR CODES">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-primary/10">
                  <th className="text-left py-1.5 pr-3 text-muted-foreground">Status</th>
                  <th className="text-left py-1.5 pr-3 text-muted-foreground">Meaning</th>
                  <th className="text-left py-1.5 text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody className="text-foreground/80">
                <tr className="border-b border-primary/5">
                  <td className="py-1.5 pr-3 text-primary">400</td>
                  <td className="py-1.5 pr-3">Bad request</td>
                  <td className="py-1.5">Check prompt and parameters</td>
                </tr>
                <tr className="border-b border-primary/5">
                  <td className="py-1.5 pr-3 text-primary">401</td>
                  <td className="py-1.5 pr-3">Unauthorized</td>
                  <td className="py-1.5">Check your API key</td>
                </tr>
                <tr className="border-b border-primary/5">
                  <td className="py-1.5 pr-3 text-primary">402</td>
                  <td className="py-1.5 pr-3">Insufficient credits</td>
                  <td className="py-1.5">Top up at the dashboard</td>
                </tr>
                <tr className="border-b border-primary/5">
                  <td className="py-1.5 pr-3 text-primary">403</td>
                  <td className="py-1.5 pr-3">Email not verified</td>
                  <td className="py-1.5">Verify your account's email address, then retry</td>
                </tr>
                <tr className="border-b border-primary/5">
                  <td className="py-1.5 pr-3 text-primary">429</td>
                  <td className="py-1.5 pr-3">Rate limited</td>
                  <td className="py-1.5">Wait and retry (30 req/min default)</td>
                </tr>
                <tr className="border-b border-primary/5">
                  <td className="py-1.5 pr-3 text-primary">502</td>
                  <td className="py-1.5 pr-3">Generation failed</td>
                  <td className="py-1.5">Retry — credits are auto-refunded</td>
                </tr>
                <tr className="border-b border-primary/5">
                  <td className="py-1.5 pr-3 text-primary">503</td>
                  <td className="py-1.5 pr-3">Engine not configured</td>
                  <td className="py-1.5">The GPU backend is down — nothing is charged</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-primary">504</td>
                  <td className="py-1.5 pr-3">Timeout</td>
                  <td className="py-1.5">Video took too long — credits refunded</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* Rate limits */}
        <Section title="⏱ RATE LIMITS">
          <p className="text-sm text-foreground/80 font-mono">
            Default: <strong className="text-primary">30 requests per minute</strong> per API key.
            If you need higher limits, contact us.
          </p>
        </Section>

        {/* Pricing */}
        <Section title="💰 PRICING">
          <p className="text-sm text-foreground/80 font-mono">
            API usage deducts credits from your account at the same rates as the web app.
            Purchase credits or subscribe at{" "}
            <a href={APP_URL} className="text-primary underline">{APP_URL}</a>.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">5 cr</div>
              <div className="text-xs text-muted-foreground font-mono">GLTCH edit</div>
            </div>
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">3 cr</div>
              <div className="text-xs text-muted-foreground font-mono">GLTCH PRO image</div>
            </div>
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">15 cr</div>
              <div className="text-xs text-muted-foreground font-mono">GLTCH PRO video</div>
            </div>
          </div>
        </Section>

        {/* XRGE Bank & Loyalty */}
        <Section title="🏦 XRGE BANK & LOYALTY">
          <p className="text-sm text-foreground/80 font-mono">
            Deposit <strong className="text-pink-400">$XRGE</strong> (Base chain) into your bank, buy credits from your balance,
            or withdraw anytime. The more XRGE you spend, the higher your loyalty tier and bonus:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="border border-amber-600/30 rounded-lg p-3 text-center bg-amber-900/10">
              <div className="text-lg font-mono font-bold text-amber-500">+30%</div>
              <div className="text-xs text-amber-400 font-orbitron tracking-wider">BRONZE</div>
              <div className="text-[10px] text-muted-foreground font-mono mt-1">Default</div>
            </div>
            <div className="border border-slate-400/30 rounded-lg p-3 text-center bg-slate-700/10">
              <div className="text-lg font-mono font-bold text-slate-300">+35%</div>
              <div className="text-xs text-slate-300 font-orbitron tracking-wider">SILVER</div>
              <div className="text-[10px] text-muted-foreground font-mono mt-1">50M XRGE spent</div>
            </div>
            <div className="border border-yellow-500/30 rounded-lg p-3 text-center bg-yellow-900/10">
              <div className="text-lg font-mono font-bold text-yellow-400">+42%</div>
              <div className="text-xs text-yellow-400 font-orbitron tracking-wider">GOLD</div>
              <div className="text-[10px] text-muted-foreground font-mono mt-1">200M XRGE spent</div>
            </div>
            <div className="border border-cyan-400/30 rounded-lg p-3 text-center bg-cyan-900/10">
              <div className="text-lg font-mono font-bold text-cyan-300">+50%</div>
              <div className="text-xs text-cyan-300 font-orbitron tracking-wider">DIAMOND</div>
              <div className="text-[10px] text-muted-foreground font-mono mt-1">500M XRGE spent</div>
            </div>
          </div>

          <p className="text-xs text-pink-300/80 font-orbitron tracking-wider mt-3">BANK API ENDPOINTS</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border border-border/30 rounded">
              <thead>
                <tr className="border-b border-border/30 bg-card/40">
                  <th className="px-3 py-2 text-left text-muted-foreground">Method</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">Endpoint</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/20">
                  <td className="px-3 py-2 text-green-400">GET</td>
                  <td className="px-3 py-2 text-foreground/80">/api/v1/xrge-balance</td>
                  <td className="px-3 py-2 text-muted-foreground/70">Bank balance, loyalty tier, transactions</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="px-3 py-2 text-blue-400">POST</td>
                  <td className="px-3 py-2 text-foreground/80">/api/v1/xrge-deposit</td>
                  <td className="px-3 py-2 text-muted-foreground/70">Verify on-chain deposit → credit bank</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="px-3 py-2 text-blue-400">POST</td>
                  <td className="px-3 py-2 text-foreground/80">/api/v1/xrge-purchase</td>
                  <td className="px-3 py-2 text-muted-foreground/70">Buy credits from bank balance</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-blue-400">POST</td>
                  <td className="px-3 py-2 text-foreground/80">/api/v1/xrge-withdraw</td>
                  <td className="px-3 py-2 text-muted-foreground/70">Request XRGE withdrawal to wallet</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground/70 font-mono">
            Tiers are permanent — once you reach a tier, you keep it. Open the XRGE Bank from the credit store.
          </p>
        </Section>

        {/* API Playground */}
        <Section title="🧪 API PLAYGROUND">
          <ApiPlayground baseUrl={baseUrl} />
        </Section>

        {/* Footer */}
        <div className="border-t border-primary/10 pt-6 text-center">
          <p className="text-xs text-muted-foreground font-mono">
            Need help?{" "}
            <a href="https://discord.gg/gltch" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              Join our Discord <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
      </div>
    </CyberLayout>
  );
}
