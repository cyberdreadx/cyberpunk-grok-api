import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        orbitron: ["Orbitron", "sans-serif"],
        "mono-share": ["Share Tech Mono", "monospace"],
        rajdhani: ["Rajdhani", "sans-serif"],
        jetbrains: ["JetBrains Mono", "monospace"],
      },
      colors: {
        /* Mission-control re-skin, matched to the 3D city: components written
           against the old neon palette (text-cyan-400, border-pink-500,
           bg-purple-900/40, ...) pick up the new identity without touching
           every call site. cyan → steel-white tower glow · pink/fuchsia →
           muted ember · purple/violet → steel. Red stays scarce: it only
           enters through --primary, --destructive and stock red-*.
           green/amber/red/yellow stay stock (semantic success/warn/error). */
        cyan: {
          50: "#fcfdfe", 100: "#f5f7fa", 200: "#e8ebf0", 300: "#d2d8e0",
          400: "#aeb7c4", 500: "#8d97a7", 600: "#707a8b", 700: "#5b6373",
          800: "#4c535f", 900: "#404550", 950: "#2a2d35",
        },
        pink: {
          50: "#fdf5f0", 100: "#fbe7dc", 200: "#f7cab4", 300: "#f1a584",
          400: "#e87d52", 500: "#d96130", 600: "#bf4c20", 700: "#9e3d1c",
          800: "#80341d", 900: "#682c1b", 950: "#39140a",
        },
        fuchsia: {
          50: "#fdf5f0", 100: "#fbe7dc", 200: "#f7cab4", 300: "#f1a584",
          400: "#e87d52", 500: "#d96130", 600: "#bf4c20", 700: "#9e3d1c",
          800: "#80341d", 900: "#682c1b", 950: "#39140a",
        },
        purple: {
          50: "#f7f8fa", 100: "#eef0f4", 200: "#d9dde5", 300: "#b9c0cd",
          400: "#939db0", 500: "#758096", 600: "#5d677c", 700: "#4c5465",
          800: "#414855", 900: "#393e49", 950: "#262931",
        },
        violet: {
          50: "#f7f8fa", 100: "#eef0f4", 200: "#d9dde5", 300: "#b9c0cd",
          400: "#939db0", 500: "#758096", 600: "#5d677c", 700: "#4c5465",
          800: "#414855", 900: "#393e49", 950: "#262931",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        neon: {
          cyan: "hsl(var(--neon-cyan))",
          magenta: "hsl(var(--neon-magenta))",
          purple: "hsl(var(--neon-purple))",
          yellow: "hsl(var(--neon-yellow))",
          red: "hsl(var(--neon-red))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        flicker: {
          "0%, 100%": { opacity: "1" },
          "33%": { opacity: "0.95" },
          "66%": { opacity: "0.98" },
          "92%": { opacity: "0.9" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        flicker: "flicker 4s ease-in-out infinite",
        "slide-up": "slide-up 0.5s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
