import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/log-viewer/',
  build: {
    rollupOptions: {
      // Two HTML entries:
      //   `/`              → marketing landing (no PWA, no workers)
      //   `/app/`          → the actual log viewer (PWA + sqlite-wasm + workers)
      // Vite preserves the relative folder structure in `dist/`, so the
      // landing lands at `dist/index.html` and the demo at `dist/app/index.html`.
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: {
        enabled: true,
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Log Viewer',
        short_name: 'Logs',
        description: 'PWA для просмотра логов',
        theme_color: '#1f2937',
        background_color: '#ffffff',
        display: 'standalone',
        // PWA install-prompt fires only for URLs inside `scope`. By
        // scoping the manifest to `/log-viewer/app/` the install
        // affordance appears only on the demo page; the landing at
        // `/log-viewer/` stays a plain webpage.
        start_url: '/log-viewer/app/',
        scope: '/log-viewer/app/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // SPA fallback now points at the demo entry; the landing is a
        // real static `index.html` and must NOT be rewritten to the
        // demo. Deny the landing URLs explicitly.
        navigateFallback: '/log-viewer/app/index.html',
        navigateFallbackDenylist: [
          /^\/log-viewer\/$/,
          /^\/log-viewer\/index\.html$/,
        ],
      },
    }),
  ],
})
