import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { cpSync, mkdirSync, existsSync } from 'node:fs';

// Ship PDF.js resources with the site, including CJK character maps. No CDN requests.
mkdirSync('public/pdfjs', { recursive: true });
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
mkdirSync('public/licenses', { recursive: true });
for (const name of ['react', 'react-dom', '@xyflow/react', '@xyflow/system', 'pdfjs-dist', 'dexie', 'jszip', 'zustand', 'zod', 'lucide-react', 'vite-plugin-pwa', 'workbox-window', 'workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies', 'workbox-expiration']) {
  for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENSE.markdown']) {
    const source = `node_modules/${name}/${file}`;
    if (existsSync(source)) cpSync(source, `public/licenses/${name.replaceAll('/', '-')}-${file}`);
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'sample.pdf'],
    manifest: {
      name: 'PaperReader', short_name: 'PaperReader', lang: 'zh-Hant',
      description: '從閱讀到理解，你的私人研究工作台。',
      theme_color: '#355c4b', background_color: '#f6f7f3', display: 'standalone',
      icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: { maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, globPatterns: ['**/*.{js,mjs,css,html,svg,pdf,woff,woff2,ttf,pfb,wasm,bcmap}'], cleanupOutdatedCaches: true },
  })],
  build: { chunkSizeWarningLimit: 1800 },
});
