import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  /** When `VITE_API_URL` is unset, `apiFetch` uses relative `/api` — Vite must proxy to a real backend or every request 404s. */
  const devApiProxyTarget =
    env.VITE_DEV_API_PROXY_TARGET || "https://cyberpunk-grok-api.vercel.app";

  return {
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
      },
    },
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "GROK_RUNNER — Neural Rendering Interface",
        short_name: "GROK_RUNNER",
        description: "AI image & video generation with a cyberpunk twist — powered by xAI",
        theme_color: "#00ffff",
        background_color: "#0a0a14",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Lazy-loaded chunks: skip precache to keep PWA install lightweight.
        // heic2any (~1.3 MB) loaded only for HEIC uploads; vendor-3d (~800 KB) loaded for 3D orb.
        globIgnores: ["**/heic2any-*.js", "**/vendor-3d-*.js", "**/vendor-charts-*.js"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/assets\/.*\.js$/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "js-chunks-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  build: {
    // heic2any (~1.3 MB) is lazy-loaded on demand only; vendor-3d (~800 KB) is lazy via GrokOrb.
    // Both are fine — suppress the warning.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("three") || id.includes("@react-three")) return "vendor-3d";
            if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
            // Keep react-dom and radix-ui together to avoid circular chunk deps
            if (id.includes("react-dom") || id.includes("@radix-ui")) return "vendor-ui";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
};
});
