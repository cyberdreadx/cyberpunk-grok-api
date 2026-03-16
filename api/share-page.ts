/**
 * /api/share-page — Server-rendered share landing page.
 *
 * Serves a full HTML page with dynamic OG meta tags so social previews
 * (Twitter, Discord, Reddit, iMessage) show the actual generated image.
 * Also renders a conversion-focused landing page with CTAs.
 *
 * Invoked via vercel.json rewrite: /s/:shareId → /api/share-page?id=:shareId
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 10 };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function notFoundPage(host: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Not Found — Grok Runner</title>
  <meta property="og:title" content="Grok Runner — AI Image & Video Generator" />
  <meta property="og:description" content="Create stunning AI art, edit photos, and generate videos. Powered by xAI." />
  <meta property="og:image" content="https://${host}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>${baseCSS()}</style>
</head>
<body>
  <div class="container center-col">
    <h1 class="glitch-title" style="color:#ff4444">LINK_NOT_FOUND</h1>
    <p class="mono" style="color:#888;margin:16px 0">This share link doesn't exist or has expired.</p>
    <a href="https://${host}/" class="cta-primary">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 5.5H19l-4.5 3.5 1.5 5.5-4.5-3.5L7 17l1.5-5.5L4 8h5.5z"/></svg>
      CREATE YOUR OWN
    </a>
  </div>
</body>
</html>`;
}

function baseCSS(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700&family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Rajdhani', sans-serif;
      background: #0a0b0f;
      color: #d4f0f0;
      min-height: 100vh;
    }
    .container { max-width: 720px; margin: 0 auto; padding: 0 16px; }
    .center-col { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; text-align:center; }
    .mono { font-family: 'Share Tech Mono', monospace; }

    /* Header */
    .header {
      position: sticky; top: 0; z-index: 50;
      background: rgba(10,11,15,0.92); backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(0,255,255,0.12);
      padding: 12px 0;
    }
    .header-inner { display:flex; align-items:center; justify-content:space-between; max-width:720px; margin:0 auto; padding:0 16px; }
    .brand {
      font-family: 'Orbitron', sans-serif; font-size: 13px; letter-spacing: 3px;
      color: #00ffff; text-decoration: none;
      text-shadow: 0 0 10px rgba(0,255,255,0.3);
    }
    .brand:hover { color: #00e5e5; }
    .header-cta {
      font-family: 'Orbitron', sans-serif; font-size: 9px; letter-spacing: 2px;
      color: #00ffff; background: rgba(0,255,255,0.08);
      border: 1px solid rgba(0,255,255,0.3); border-radius: 4px;
      padding: 6px 14px; text-decoration: none;
      transition: all 0.2s;
    }
    .header-cta:hover { background: rgba(0,255,255,0.15); border-color: rgba(0,255,255,0.5); }

    /* Media */
    .media-wrap {
      margin-top: 24px; border-radius: 8px; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(0,0,0,0.3);
      position: relative;
    }
    .media-wrap img, .media-wrap video {
      width: 100%; max-height: 75vh; object-fit: contain; display: block;
    }
    .media-badge {
      position: absolute; top: 12px; left: 12px;
      font-family: 'Share Tech Mono', monospace; font-size: 9px;
      background: rgba(10,11,15,0.85); color: #00ffff;
      padding: 3px 8px; border-radius: 3px; letter-spacing: 1px;
    }

    /* Prompt */
    .prompt-card {
      margin-top: 16px; padding: 16px 20px;
      border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);
      background: rgba(20,22,30,0.6);
    }
    .prompt-label {
      font-family: 'Orbitron', sans-serif; font-size: 9px;
      color: rgba(255,255,255,0.35); letter-spacing: 3px; margin-bottom: 8px;
    }
    .prompt-text {
      font-family: 'Rajdhani', sans-serif; font-size: 15px;
      color: rgba(212,240,240,0.85); line-height: 1.6;
    }

    /* CTA Section */
    .cta-section {
      margin: 28px 0 40px; padding: 24px;
      border-radius: 8px;
      border: 1px solid rgba(0,255,255,0.15);
      background: linear-gradient(135deg, rgba(0,255,255,0.04) 0%, rgba(180,0,255,0.04) 100%);
      text-align: center;
    }
    .cta-heading {
      font-family: 'Orbitron', sans-serif; font-size: 14px;
      letter-spacing: 3px; color: #00ffff; margin-bottom: 6px;
      text-shadow: 0 0 15px rgba(0,255,255,0.2);
    }
    .cta-sub {
      font-family: 'Share Tech Mono', monospace; font-size: 11px;
      color: rgba(255,255,255,0.4); margin-bottom: 20px;
    }
    .cta-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .cta-primary {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: 'Orbitron', sans-serif; font-size: 11px; letter-spacing: 2px;
      color: #0a0b0f; background: #00ffff;
      border: none; border-radius: 4px; padding: 10px 22px;
      text-decoration: none; cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 0 20px rgba(0,255,255,0.2);
    }
    .cta-primary:hover { background: #00e5e5; box-shadow: 0 0 30px rgba(0,255,255,0.35); }
    .cta-secondary {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: 'Orbitron', sans-serif; font-size: 11px; letter-spacing: 2px;
      color: #00ffff; background: transparent;
      border: 1px solid rgba(0,255,255,0.3); border-radius: 4px;
      padding: 10px 22px; text-decoration: none; cursor: pointer;
      transition: all 0.2s;
    }
    .cta-secondary:hover { background: rgba(0,255,255,0.08); border-color: rgba(0,255,255,0.5); }
    .cta-tertiary {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: 'Orbitron', sans-serif; font-size: 10px; letter-spacing: 2px;
      color: rgba(180,0,255,0.8); background: transparent;
      border: 1px solid rgba(180,0,255,0.25); border-radius: 4px;
      padding: 10px 18px; text-decoration: none;
      transition: all 0.2s;
    }
    .cta-tertiary:hover { background: rgba(180,0,255,0.08); border-color: rgba(180,0,255,0.4); }

    /* Features strip */
    .features {
      display: flex; gap: 24px; justify-content: center; flex-wrap: wrap;
      margin-top: 20px; padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    .feature {
      font-family: 'Share Tech Mono', monospace; font-size: 10px;
      color: rgba(255,255,255,0.3); letter-spacing: 1px;
      display: flex; align-items: center; gap: 6px;
    }
    .feature-dot { width:5px; height:5px; border-radius:50%; background:#00ffff; opacity:0.5; }

    /* Footer */
    .footer {
      text-align: center; padding: 20px 0;
      border-top: 1px solid rgba(255,255,255,0.04);
      font-family: 'Share Tech Mono', monospace; font-size: 10px;
      color: rgba(255,255,255,0.2);
    }
    .footer a { color: rgba(0,255,255,0.4); text-decoration: none; }
    .footer a:hover { color: rgba(0,255,255,0.7); }

    /* Scanline effect */
    body::after {
      content: ''; position: fixed; inset: 0; z-index: 999; pointer-events: none;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px);
    }

    @media (max-width: 480px) {
      .cta-row { flex-direction: column; align-items: stretch; }
      .cta-primary, .cta-secondary, .cta-tertiary { justify-content: center; }
      .features { gap: 12px; }
    }
  `;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = req.headers.host || "grokrunner.gltch.app";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const shareId = (req.query.id as string) || "";
  if (!shareId || !/^[a-zA-Z0-9_-]{4,16}$/.test(shareId)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send(notFoundPage(host));
  }

  try {
    const { list } = await import("@vercel/blob");
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
    const { blobs } = await list({ prefix: `shares/${shareId}.json`, token: blobToken });

    if (blobs.length === 0) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).send(notFoundPage(host));
    }

    const metaResp = await fetch(blobs[0].url);
    if (!metaResp.ok) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).send(notFoundPage(host));
    }
    const meta = await metaResp.json();
    const mediaUrl = meta.mediaUrl;

    const safePrompt = escapeHtml(meta.prompt || "");
    const truncatedPrompt = truncate(meta.prompt || "AI-generated with Grok Runner", 200);
    const isVideo = meta.mediaType === "video";
    const typeBadge = isVideo ? "VIDEO" : "IMAGE";

    const ogTitle = safePrompt
      ? `"${escapeHtml(truncate(meta.prompt, 60))}" — Made with Grok Runner`
      : "AI Creation — Made with Grok Runner";
    const ogDesc = safePrompt
      ? `${escapeHtml(truncatedPrompt)} — Try this prompt or create your own AI art at Grok Runner.`
      : "Create stunning AI images, edit photos, and generate videos. Powered by xAI.";

    const tryPromptUrl = `${baseUrl}/?prompt=${encodeURIComponent(meta.prompt || "")}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${ogTitle}</title>
  <meta name="description" content="${ogDesc}" />

  <!-- Open Graph -->
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:type" content="${isVideo ? "video.other" : "article"}" />
  <meta property="og:url" content="${baseUrl}/s/${escapeHtml(shareId)}" />
  ${isVideo
    ? `<meta property="og:video" content="${escapeHtml(mediaUrl)}" />
  <meta property="og:video:type" content="video/mp4" />
  <meta property="og:image" content="${baseUrl}/og-image.png" />`
    : `<meta property="og:image" content="${escapeHtml(mediaUrl)}" />
  <meta property="og:image:width" content="1024" />
  <meta property="og:image:height" content="1024" />`}
  <meta property="og:image:alt" content="${ogDesc}" />
  <meta property="og:site_name" content="Grok Runner" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ogTitle}" />
  <meta name="twitter:description" content="${ogDesc}" />
  ${isVideo
    ? `<meta name="twitter:player" content="${escapeHtml(mediaUrl)}" />
  <meta name="twitter:image" content="${baseUrl}/og-image.png" />`
    : `<meta name="twitter:image" content="${escapeHtml(mediaUrl)}" />`}

  <link rel="canonical" href="${baseUrl}/s/${escapeHtml(shareId)}" />
  <link rel="icon" type="image/png" href="/pwa-192.png" />
  <style>${baseCSS()}</style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-inner">
      <a href="${baseUrl}/" class="brand">GROK_RUNNER</a>
      <a href="${baseUrl}/" class="header-cta">
        ✦ CREATE YOUR OWN
      </a>
    </div>
  </div>

  <div class="container">
    <!-- Media -->
    <div class="media-wrap">
      ${isVideo
        ? `<video src="${escapeHtml(mediaUrl)}" controls autoplay muted playsinline preload="auto"></video>`
        : `<img src="${escapeHtml(mediaUrl)}" alt="${safePrompt || "AI-generated image"}" loading="eager" />`}
      <div class="media-badge">${typeBadge} — AI GENERATED</div>
    </div>

    <!-- Prompt -->
    ${safePrompt ? `
    <div class="prompt-card">
      <div class="prompt-label">PROMPT USED</div>
      <p class="prompt-text">${safePrompt}</p>
    </div>
    ` : ""}

    <!-- CTA Section -->
    <div class="cta-section">
      <div class="cta-heading">LIKE WHAT YOU SEE?</div>
      <div class="cta-sub">Create your own AI art — free to start, no download required</div>
      <div class="cta-row">
        ${safePrompt ? `
        <a href="${escapeHtml(tryPromptUrl)}" class="cta-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/></svg>
          TRY THIS PROMPT
        </a>
        ` : ""}
        <a href="${baseUrl}/" class="cta-secondary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 5.5H19l-4.5 3.5 1.5 5.5-4.5-3.5L7 17l1.5-5.5L4 8h5.5z"/></svg>
          CREATE YOUR OWN
        </a>
        <a href="${escapeHtml(mediaUrl)}" target="_blank" rel="noopener noreferrer" class="cta-tertiary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          DOWNLOAD
        </a>
      </div>

      <div class="features">
        <div class="feature"><span class="feature-dot"></span>TEXT TO IMAGE</div>
        <div class="feature"><span class="feature-dot"></span>AI VIDEO</div>
        <div class="feature"><span class="feature-dot"></span>PHOTO EDITING</div>
        <div class="feature"><span class="feature-dot"></span>NSFW OK</div>
      </div>
    </div>

    <div class="footer">
      <a href="${baseUrl}/">grokrunner.gltch.app</a> — Powered by xAI Grok & FLUX
    </div>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(html);
  } catch (err: any) {
    console.error("[share-page] Error:", err.message);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(notFoundPage(host));
  }
}
