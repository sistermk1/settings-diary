import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'VILDUP — Setup Diary for Gamers',
        short_name: 'VILDUP',
        description: '競技ゲーマー向けのデバイス設定・感度記録アプリ',
        lang: 'ja',
        theme_color: '#4F0C28',
        background_color: '#f6f6f4',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // app shell precache → offline start / browse / log (spec §6)
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Gen Interface JP webfont (CSS + woff2 from jsDelivr) — cache so
            // typography survives offline; falls back to system fonts before
            // the first visit completes
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jsdelivr-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Drive / Google auth requests must never be served from cache
        // (they don't match any rule above, so they stay network-only)
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
