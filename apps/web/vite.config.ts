import path from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// `npm run dev:https` serves the dev app over HTTPS with a self-signed
// certificate. Phones only grant camera access in a secure context, so this
// is how the scanner is tested on a real device over the local network.
const https = process.env.VITE_DEV_HTTPS === 'true';
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  // Shown in small print on the ticket page: tells at a glance which build a phone is running.
  define: { __BUILD_ID__: JSON.stringify((process.env.COMMIT_REF ?? 'dev').slice(0, 7)) },
  plugins: [
    react(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Propusnica — skener ulaznica',
        short_name: 'Skener',
        description: 'Skeniranje QR ulaznica na ulazu.',
        lang: 'sr-Latn',
        start_url: '/scanner',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0A0F1A',
        theme_color: '#0A0F1A',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the static app shell is cached. API responses (tickets, guest
        // data, scan results) are never stored by the service worker.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@event-platform/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/uploads': { target: apiTarget, changeOrigin: false },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/uploads': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
