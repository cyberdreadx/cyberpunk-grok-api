# ⚡ GROK_IMAGINE

> Cyberpunk neural rendering interface for xAI's Grok Imagine API.

![GROK_IMAGINE Banner](public/og-image.png)

## What is this?

A **fully client-side** web app that lets you interact with every feature of the [xAI Grok Imagine API](https://docs.x.ai/docs/guides/image-generation) through a cyberpunk-themed interface. Your API key stays in your browser — nothing is ever sent to a third-party server.

### Features

| Mode | Description |
|------|-------------|
| 🖼️ **GENERATE** | Text → Image generation |
| ✏️ **MODIFY** | Edit existing images with prompts |
| 🎬 **RENDER** | Text → Video generation |
| 🎞️ **ANIMATE** | Image → Video animation |

### Additional Features

- **Settings Panel** — Resolution (512² to 1792×1024), batch count (×1–×4), output format (URL / BASE64)
- **Prompt History** — Auto-saved, searchable, reusable prompts with localStorage persistence
- **PWA Support** — Install on any phone as a native-feeling app
- **Results Gallery** — Expand, download, open in new tab
- **API Key Management** — Stored locally, never transmitted

## 🔒 Privacy

| Concern | Status |
|---------|--------|
| API key storage | Browser localStorage only |
| API calls | Direct to `api.x.ai`, no middleman |
| Server-side code | None — pure static files |
| Telemetry | None |
| Data persistence | All local |

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## 🏠 Self-Hosting

See [SELF-HOSTING.md](SELF-HOSTING.md) for complete instructions on running privately via:

- 📱 **iPhone (iSH terminal)**
- 🐳 **Docker** (Synology, QNAP, Unraid, TrueNAS)
- 💻 **Any static server** (npx serve, Python, PHP)
- 🔐 **Tailscale / ZeroTier** for secure remote access

## 🛠️ Tech Stack

- **React** + **TypeScript** + **Vite**
- **Tailwind CSS** with custom cyberpunk design system
- **shadcn/ui** components
- **PWA** via vite-plugin-pwa
- Fonts: Orbitron, Share Tech Mono, Rajdhani

## 📝 License

Private project. All rights reserved.
