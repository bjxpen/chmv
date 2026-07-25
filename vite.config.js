import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  worker: { format: 'es' },
  plugins: [
    // singlefile build only when explicitly requested via env
    ...(process.env.SINGLEFILE
      ? [viteSingleFile()]
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icons/icon.svg'],
            workbox: {
              globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
              /* the app makes zero network calls at runtime; precache is all we need */
              navigateFallback: 'index.html',
            },
            manifest: {
              name: 'chmv — CHM Reader',
              short_name: 'chmv',
              description:
                'A private, offline CHM reader. Parses and renders .chm files entirely in your browser — nothing is uploaded.',
              id: 'chmv',
              start_url: '.',
              scope: '.',
              display: 'standalone',
              display_override: ['window-controls-overlay', 'standalone'],
              background_color: '#f7f6f3',
              theme_color: '#1c1917',
              lang: 'en',
              categories: ['books', 'utilities', 'productivity'],
              icons: [
                { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
                { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
              file_handlers: [
                { action: '.', accept: { 'application/vnd.ms-htmlhelp': ['.chm'] } },
              ],
              launch_handler: { client_mode: 'focus-existing' },
            },
          }),
        ]),
  ],
});
