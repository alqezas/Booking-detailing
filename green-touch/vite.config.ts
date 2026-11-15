import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // injectManifest: our own Workbox worker (src/sw.ts), registered by src/lib/pwa.ts.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      manifest: {
        name: 'Green Touch — косметика від косметолога',
        short_name: 'Green Touch',
        lang: 'uk',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#FBF8F1',
        theme_color: '#FBF8F1',
        icons: [
          {src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png'},
          {src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png'},
          {src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
        ],
      },
      injectManifest: {
        globPatterns: ['assets/**/*.{js,css}', 'index.html', 'offline.html', 'placeholder.svg', 'icons/*.{png,svg}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: {enabled: false},
    }),
  ],
  server: {port: 5180, strictPort: true},
  preview: {port: 4180, strictPort: true},
  build: {target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900},
});
