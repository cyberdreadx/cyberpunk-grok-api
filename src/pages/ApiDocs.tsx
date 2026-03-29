import React, { useState } from "react";
import { Copy, Check, Key, Zap, Shield, ArrowLeft, ExternalLink } from "lucide-react";
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
            Generate images programmatically using our public API. Pay with credits from your account.
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
          </div>
        </Section>

        {/* Examples */}
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
          <div className="grid grid-cols-3 gap-3">
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">2 cr</div>
              <div className="text-xs text-muted-foreground font-mono">per standard image</div>
            </div>
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">5 cr</div>
              <div className="text-xs text-muted-foreground font-mono">per pro image</div>
            </div>
            <div className="border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-mono font-bold text-primary">3 cr</div>
              <div className="text-xs text-muted-foreground font-mono">per second of video</div>
            </div>
          </div>
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
