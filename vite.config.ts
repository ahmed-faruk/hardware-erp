import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, loadEnv } from 'vite';

import { buildHeaders } from './tools/build/headers';

export default defineConfig(({ mode }) => ({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: ['firefox115', 'chrome109', 'safari16.4'] },
  plugins: [
    react(),
    {
      // `_headers` for Cloudflare Pages, with the CSP of this environment's Supabase project
      name: 'hanafy-headers',
      apply: 'build' as const,
      closeBundle() {
        const url = process.env.VITE_SUPABASE_URL ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL;
        writeFileSync('dist/_headers', buildHeaders(url));
      },
    },
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'مركز حنفي للتلوين',
        short_name: 'حنفي',
        lang: 'ar',
        dir: 'rtl',
        display: 'standalone',
        background_color: '#F7F6F3',
        theme_color: '#1D4ED8',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2,mp3}'] },
    }),
  ],
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/int/**/*.test.ts',
      'tools/ospos-import/**/*.test.ts',
      'tools/build/**/*.test.ts',
    ],
  },
}));
