import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {tenantHtml} from './build/tenant-html.ts';

export default defineConfig({
  plugins: [
    react(),
    tenantHtml(),
    // injectManifest: our own worker (src/sw.ts). Manifests are per studio
    // (scripts/tenant-assets.ts), so the plugin's manifest is off, and the
    // worker is registered per studio scope by src/lib/pwa.ts.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['assets/**/*.{js,css,woff2}'],
        // The worker is copied into /s/<slug>/; absolute URLs keep precache paths valid there.
        modifyURLPrefix: {'assets/': '/assets/'},
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        rollupFormat: 'iife',
      },
      devOptions: {enabled: false},
    }),
  ],
  server: {port: 5173, strictPort: true},
  preview: {port: 4173, strictPort: true},
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
