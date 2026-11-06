import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
const base = process.env.VITE_BASE_PATH || "/oweme/";
export default defineConfig({
  base,
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "OweMe",
        short_name: "OweMe",
        description: "Your lending notebook, thoughtfully connected.",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#F7F8FB",
        theme_color: "#6B4EFF",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
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
        globPatterns: ["**/*.{js,css,html,png,svg,woff,woff2,ttf}"],
        maximumFileSizeToCacheInBytes: 6000000,
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
  },
  build: { chunkSizeWarningLimit: 1800 },
});
