import React, { useState, useCallback } from "react";
import { Copy, Check, Key, Zap, Shield, ArrowLeft, ExternalLink, Play, Loader2, Image, Video, Wand2, Cpu } from "lucide-react";
import { Link } from "react-router-dom";
import CyberLayout from "@/components/CyberLayout";
import GlitchText from "@/components/GlitchText";
import { Button } from "@/components/ui/button";

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
  const [engine, setEngine] = useState<"grok" | "gltch" | "comfy">("grok");
  const [genType, setGenType] = useState<"image" | "video">("image");
  const [model, setModel] = useState("grok-2-image");
  const [n, setN] = useState(1);
  const [duration, setDuration] = useState(5);
  const [imageUrl, setImageUrl] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [hd, setHd] = useState(false);
  const [comfyWorkflow, setComfyWorkflow] = useState("txt2img");
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

    if (engine === "grok") {
      url = `${baseUrl}/api/v1/generate`;
      if (genType === "video") {
        body.type = "video";
        body.duration = duration;
      } else {
        body.model = model;
        body.n = n;
      }
    } else if (engine === "gltch") {
      url = `${baseUrl}/api/v1/gltch`;
      if (!imageUrl.trim()) { setError("GLTCH requires an image_url"); setLoading(false); return; }
      body.image_url = imageUrl.trim();
      body.aspect_ratio = aspectRatio;
      body.hd = hd;
    } else {
      url = `${baseUrl}/api/v1/comfy`;
      body.workflow = comfyWorkflow;
      if (["klein", "wan-video", "gltch-wan"].includes(comfyWorkflow)) {
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
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiKey, prompt, engine, genType, model, n, duration, imageUrl, aspectRatio, hd, comfyWorkflow, baseUrl]);

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
          { id: "grok" as const, icon: Zap, label: "GROK" },
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

      {/* Grok sub-type toggle */}
      {engine === "grok" && (
        <div className="flex gap-2">
          <button
            onClick={() => setGenType("image")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
              genType === "image"
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-muted/30 border-primary/10 text-muted-foreground hover:border-primary/20"
            }`}
          >
            <Image className="w-3 h-3" /> IMAGE
          </button>
          <button
            onClick={() => setGenType("video")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
              genType === "video"
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-muted/30 border-primary/10 text-muted-foreground hover:border-primary/20"
            }`}
          >
            <Video className="w-3 h-3" /> VIDEO
          </button>
        </div>
      )}

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
      {(engine === "gltch" || (engine === "comfy" && ["klein", "wan-video", "gltch-wan"].includes(comfyWorkflow))) && (
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
        {engine === "grok" && genType === "image" && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">MODEL</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="bg-muted/50 border border-primary/20 rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="grok-2-image">grok-2-image (2 cr)</option>
                <option value="grok-2-image-pro">grok-2-image-pro (5 cr)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">COUNT (n)</label>
              <select
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="bg-muted/50 border border-primary/20 rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
              >
                {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </>
        )}
        {engine === "grok" && genType === "video" && (
          <div className="space-y-1">
            <label className="text-xs font-mono text-muted-foreground">DURATION</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="bg-muted/50 border border-primary/20 rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value={5}>5s (15 cr)</option>
              <option value={10}>10s (30 cr)</option>
            </select>
          </div>
        )}
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
              <option value="txt2img">txt2img (3 cr)</option>
              <option value="klein">klein edit (3 cr)</option>
              <option value="wan-video">wan-video (15 cr)</option>
              <option value="gltch-wan">gltch-wan (15 cr)</option>
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
  const baseUrl = "https://grokrunner.gltch.app";

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
            Generate images and videos programmatically using GROK, GLTCH, and GLTCH PRO engines. Pay with credits from your account.
          </p>
        </div>

        {/* Quick start */}
        <Section title="⚡ QUICK START">
          <ol className="list-decimal list-inside space-y-2 text-sm text-foreground/80 font-mono">
            <li><a href={baseUrl} className="text-primary underline">{baseUrl}</a></li>
            <li>Generate an API key from the <strong className="text-primary">API KEYS</strong> button on the main page</li>
            <li>Use the key in your requests via the <code className="text-primary bg-muted/50 px-1 rounded">X-API-Key</code> header</li>
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
            {/* Image Generation */}
            <div className="border border-primary/20 rounded-lg overflow-hidden">
              <div className="bg-primary/5 px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-0.5 rounded">POST</span>
                <code className="text-sm font-mono text-foreground">/api/v1/generate</code>
                <span className="text-[10px] font-mono text-muted-foreground ml-auto">IMAGE</span>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-foreground/80 font-mono">Generate images from a text prompt.</p>

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
                          <td className="py-1.5 pr-3 text-primary">type</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">image</td>
                          <td className="py-1.5">"image" or "video"</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">model</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">grok-2-image</td>
                          <td className="py-1.5">Model to use (see below)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">n</td>
                          <td className="py-1.5 pr-3">integer</td>
                          <td className="py-1.5 pr-3">1</td>
                          <td className="py-1.5">Number of images (1–4)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-3 text-primary">response_format</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">url</td>
                          <td className="py-1.5">"url" or "b64_json"</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">IMAGE MODELS</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-primary/10">
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Model</th>
                          <th className="text-left py-1.5 pr-3 text-muted-foreground">Credits/image</th>
                          <th className="text-left py-1.5 text-muted-foreground">Description</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground/80">
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">grok-2-image</td>
                          <td className="py-1.5 pr-3">2 cr</td>
                          <td className="py-1.5">Standard quality, fast generation</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-3 text-primary">grok-2-image-pro</td>
                          <td className="py-1.5 pr-3">5 cr</td>
                          <td className="py-1.5">Higher quality, more detail</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Video Generation */}
            <div className="border border-primary/20 rounded-lg overflow-hidden">
              <div className="bg-primary/5 px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-0.5 rounded">POST</span>
                <code className="text-sm font-mono text-foreground">/api/v1/generate</code>
                <span className="text-[10px] font-mono text-muted-foreground ml-auto">VIDEO</span>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-foreground/80 font-mono">
                  Generate videos from text (or image + text). The API polls for completion and returns the final video URL — no polling needed on your end.
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
                          <td className="py-1.5 pr-3 text-primary">type *</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">—</td>
                          <td className="py-1.5">Must be "video"</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">duration</td>
                          <td className="py-1.5 pr-3">integer</td>
                          <td className="py-1.5 pr-3">5</td>
                          <td className="py-1.5">5 or 10 seconds</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-3 text-primary">image_url</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">—</td>
                          <td className="py-1.5">Optional source image for image-to-video</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-3 bg-muted/30 border border-primary/10 rounded-lg">
                  <Zap className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-xs text-foreground/70 font-mono">
                    Video generation takes 30–120 seconds. The API handles polling internally and returns the final video URL when ready. Credit cost: <strong className="text-primary">3 cr/second</strong> (15 cr for 5s, 30 cr for 10s).
                  </p>
                </div>
              </div>
            </div>

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
                          <td className="py-1.5 pr-3">txt2img</td>
                          <td className="py-1.5">txt2img, klein, wan-video, gltch-wan</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">image_url</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">—</td>
                          <td className="py-1.5">Required for klein, wan-video, gltch-wan</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">width / height</td>
                          <td className="py-1.5 pr-3">integer</td>
                          <td className="py-1.5 pr-3">832×1216</td>
                          <td className="py-1.5">Image dimensions (256–2048)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">steps</td>
                          <td className="py-1.5 pr-3">integer</td>
                          <td className="py-1.5 pr-3">20</td>
                          <td className="py-1.5">Sampling steps (1–100)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">checkpoint</td>
                          <td className="py-1.5 pr-3">string</td>
                          <td className="py-1.5 pr-3">auto</td>
                          <td className="py-1.5">Model checkpoint (use /api/v1/models to list)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-3 text-primary">upscale</td>
                          <td className="py-1.5 pr-3">boolean</td>
                          <td className="py-1.5 pr-3">false</td>
                          <td className="py-1.5">HD upscale (adds 1 cr for edits, 3 cr for video)</td>
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
                          <td className="py-1.5 pr-3 text-primary">txt2img</td>
                          <td className="py-1.5 pr-3">3 cr</td>
                          <td className="py-1.5">Text-to-image (SD / Flux models)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">klein</td>
                          <td className="py-1.5 pr-3">3–4 cr</td>
                          <td className="py-1.5">Flux Klein image editing (+1 for HD)</td>
                        </tr>
                        <tr className="border-b border-primary/5">
                          <td className="py-1.5 pr-3 text-primary">wan-video</td>
                          <td className="py-1.5 pr-3">15 cr</td>
                          <td className="py-1.5">WAN image-to-video generation</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-3 text-primary">gltch-wan</td>
                          <td className="py-1.5 pr-3">15–18 cr</td>
                          <td className="py-1.5">GLTCH WAN video (+3 for HD)</td>
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
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">cURL — Image</h4>
              <CopyBlock code={`curl -X POST ${baseUrl}/api/v1/generate \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: gltch_sk_your_key_here" \\
  -d '{
    "prompt": "a cyberpunk cityscape at sunset, neon lights",
    "model": "grok-2-image",
    "n": 2
  }'`} />
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">cURL — Video</h4>
              <CopyBlock code={`curl -X POST ${baseUrl}/api/v1/generate \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: gltch_sk_your_key_here" \\
  -d '{
    "prompt": "a drone flyover of a neon city at night",
    "type": "video",
    "duration": 5
  }'`} />
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">Python — Image</h4>
              <CopyBlock language="python" code={`import requests

response = requests.post(
    "${baseUrl}/api/v1/generate",
    headers={
        "Content-Type": "application/json",
        "X-API-Key": "gltch_sk_your_key_here",
    },
    json={
        "prompt": "a cyberpunk cityscape at sunset",
        "model": "grok-2-image",
        "n": 1,
    },
)

data = response.json()
for image in data["data"]:
    print(image["url"])`} />
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">Python — Video (image-to-video)</h4>
              <CopyBlock language="python" code={`import requests

# Generate a video from a source image
response = requests.post(
    "${baseUrl}/api/v1/generate",
    headers={
        "Content-Type": "application/json",
        "X-API-Key": "gltch_sk_your_key_here",
    },
    json={
        "prompt": "camera slowly zooms in, cinematic lighting",
        "type": "video",
        "duration": 10,
        "image_url": "https://example.com/my-image.jpg",
    },
    timeout=300,  # videos can take a few minutes
)

data = response.json()
print(data["video_url"])
print(f"Credits used: {data['credits_used']}")`} />
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">JavaScript / Node.js</h4>
              <CopyBlock language="javascript" code={`const response = await fetch("${baseUrl}/api/v1/generate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "gltch_sk_your_key_here",
  },
  body: JSON.stringify({
    prompt: "a cyberpunk cityscape at sunset",
    model: "grok-2-image",
    n: 1,
  }),
});

const data = await response.json();
console.log(data.data[0].url);
console.log(\`Credits used: \${data.credits_used}\`);
console.log(\`Credits remaining: \${data.credits_remaining}\`);`} />
            </div>

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
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">Python — GLTCH PRO (txt2img)</h4>
              <CopyBlock language="python" code={`import requests

response = requests.post(
    "${baseUrl}/api/v1/comfy",
    headers={
        "Content-Type": "application/json",
        "X-API-Key": "gltch_sk_your_key_here",
    },
    json={
        "prompt": "ethereal forest scene, volumetric lighting",
        "workflow": "txt2img",
        "width": 832,
        "height": 1216,
        "steps": 25,
    },
    timeout=120,
)

data = response.json()
print(data["image_url"])
print(f"Credits used: {data['credits_used']}")`} />
            </div>
          </div>
        </Section>

        {/* Response */}
        <Section title="📦 RESPONSE FORMAT">
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">IMAGE RESPONSE</h4>
              <CopyBlock language="json" code={`{
  "created": 1234567890,
  "data": [
    {
      "url": "https://...",
      "revised_prompt": "expanded prompt used for generation"
    }
  ],
  "type": "image",
  "credits_used": 4,
  "credits_remaining": 146
}`} />
            </div>
            <div>
              <h4 className="text-xs font-mono font-bold text-muted-foreground mb-2">VIDEO RESPONSE</h4>
              <CopyBlock language="json" code={`{
  "type": "video",
  "video_url": "https://...",
  "duration": 5,
  "credits_used": 15,
  "credits_remaining": 131
}`} />
            </div>
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
  "workflow": "txt2img",
  "image_url": "https://...",
  "credits_used": 3,
  "credits_remaining": 138
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
                  <td className="py-1.5 pr-3 text-primary">429</td>
                  <td className="py-1.5 pr-3">Rate limited</td>
                  <td className="py-1.5">Wait and retry (30 req/min default)</td>
                </tr>
                <tr className="border-b border-primary/5">
                  <td className="py-1.5 pr-3 text-primary">502</td>
                  <td className="py-1.5 pr-3">Generation failed</td>
                  <td className="py-1.5">Retry — credits are auto-refunded</td>
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
            <a href={baseUrl} className="text-primary underline">{baseUrl}</a>.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">2 cr</div>
              <div className="text-xs text-muted-foreground font-mono">Grok image</div>
            </div>
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">5 cr</div>
              <div className="text-xs text-muted-foreground font-mono">Grok pro image</div>
            </div>
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">3 cr/s</div>
              <div className="text-xs text-muted-foreground font-mono">Grok video</div>
            </div>
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
