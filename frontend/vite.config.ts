import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      registerType: 'autoUpdate',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: [
        'pwa-icon.svg',
        'pwa-maskable-icon.svg',
        'pwa-icon-192.png',
        'pwa-icon-512.png',
      ],
      manifest: {
        name: 'Calendar',
        short_name: 'Calendar',
        description: 'Self-hosted scheduled task calendar',
        theme_color: '#176b58',
        background_color: '#f6fbf8',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/auth\//,
          /^\/admin\//,
          /^\/backup\//,
          /^\/health$/,
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'dist/**', 'node_modules/**'],
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
