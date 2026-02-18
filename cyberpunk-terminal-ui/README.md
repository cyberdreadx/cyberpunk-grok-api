# Cyberpunk Terminal UI

A standalone cyberpunk/neon terminal UI built with vanilla HTML, CSS, and JS.

## Files

| File | Description |
|------|-------------|
| `index.html` | Full terminal layout with mode selector, settings, engine picker, image input, prompt, and status bar |
| `styles.css` | Complete CSS — variables, neon glows, animations, all component styles |
| `glitch.js` | Periodic chromatic aberration glitch effect for text elements |

## Fonts

The UI uses three Google Fonts (loaded via CSS import):

- **Orbitron** — Angular, futuristic. Used for labels and headers.
- **Share Tech Mono** — Terminal monospace. Used for data values and code-like text.
- **Rajdhani** — Clean sans-serif. Used for body text and prompts.

## Color System

All colors use HSL CSS custom properties for easy theming:

- `--primary` / `--neon-cyan` — `hsl(180 100% 50%)` — Main accent (cyan)
- `--secondary` / `--neon-magenta` — `hsl(300 100% 60%)` — Secondary accent (magenta)
- `--accent` / `--neon-purple` — `hsl(270 100% 65%)` — Tertiary accent (purple)
- `--bg` — `hsl(240 15% 5%)` — Deep dark background
- `--card` — `hsl(240 12% 8%)` — Card/panel background
- `--border` — `hsl(180 60% 20%)` — Border with subtle cyan tint

## Key Design Patterns

1. **Neon glow borders** — `.neon-border` class adds cyan box-shadow glow to active elements
2. **Terminal symbols** — `$`, `❯`, `[ok]`, `pid:` used as decorative elements
3. **Traffic light dots** — macOS-style title bar with red/yellow/green dots
4. **Blinking cursor** — CSS `blink` animation on a small rectangle
5. **Glitch effect** — JS-driven chromatic aberration with cyan/magenta color splitting
6. **Tiny typography** — 8-10px fonts with wide letter-spacing for HUD feel
7. **Scanlines** — Optional repeating gradient overlay for CRT effect

## Usage

Just open `index.html` in a browser. No build tools or dependencies required.

To integrate into a React/Tailwind project, use `styles.css` as a reference
for the CSS variables, utility classes, and component patterns.
