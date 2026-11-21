import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// ProseForge Vite config.
// - Worker is emitted as a classic chunk (avoids SharedArrayBuffer CSP issues).
// - PWA is configured to NEVER cache WebLLM model shards (they live in IndexedDB
//   / Cache API and must not be purged or intercepted by Workbox).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "robots.txt"],
      manifest: {
        name: "ProseForge",
        short_name: "ProseForge",
        description:
          "100% client-side academic .docx sanitizer & multi-agent structural rewriter powered by WebGPU.",
        theme_color: "#0a0a0b",
        background_color: "#0a0a0b",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        // Hard cap on precache so model CDN ranges never get swept up. The
        // pipelineWorker chunk (~6MB) is excluded below via globIgnores so it
        // is fetched on demand instead of precached.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globIgnores: [
          "**/pipelineWorker-*.js",
          "**/webllm-*.js",
          "**/jszip-*.js",
        ],
        navigateFallback: "/index.html",
        // Never touch the WebLLM model CDN origins or IndexedDB/Cache API shards.
        navigateFallbackDenylist: [
          /^https:\/\/raw\.githubusercontent\.com\//,
          /^https:\/\/huggingface\.co\//,
          /^https:\/\/cdn\.openai\.com\//,
          /^https:\/\/.*\.hf\.co\//,
        ],
        runtimeCaching: [
          {
            // Same-origin static assets: stale-while-revalidate.
            urlPattern: ({ url }) => url.origin === self.location.origin,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "proseforge-static",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // NEVER cache model shards: deny-list them via NetworkOnly + bypass.
            urlPattern: ({ url }) =>
              /huggingface\.co|hf\.co|raw\.githubusercontent\.com|mlc\.ai/.test(
                url.href
              ),
            handler: "NetworkOnly",
            options: { cacheName: "webllm-models-DO-NOT-CACHE" },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  worker: {
    format: "es",
  },
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          webllm: ["@mlc-ai/web-llm"],
          jszip: ["jszip"],
          diff: ["diff"],
        },
      },
    },
  },
});
