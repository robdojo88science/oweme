import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
const base = process.env.VITE_BASE_PATH || '/oweme/'
export default defineConfig({
  base, plugins: [react(), tailwindcss(), VitePWA({registerType:'prompt', includeAssets:['icon.svg','apple-touch-icon.png'], manifest:{name:'OweMe',short_name:'OweMe',description:'Your lending notebook, thoughtfully connected.',start_url:base,scope:base,display:'standalone',background_color:'#FAFAFB',theme_color:'#5B5CFF',icons:[{src:'icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]},workbox:{globPatterns:['**/*.{js,css,html,png,svg,woff,woff2,ttf}'],maximumFileSizeToCacheInBytes:6000000,cleanupOutdatedCaches:true,navigateFallback:'index.html'}})],
  test:{environment:'node',include:['src/**/*.test.ts'],setupFiles:['./src/test-setup.ts']},
  build:{chunkSizeWarningLimit:1800}
})
