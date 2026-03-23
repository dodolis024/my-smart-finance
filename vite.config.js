import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readFileSync } from 'fs';

// 讓 CHANGELOG.md 在 dev 與 prod 都能以獨立檔案被 fetch，
// 避免打包進 JS bundle 後被 iOS PWA 快取住無法更新。
const changelogPlugin = {
  name: 'serve-changelog',
  configureServer(server) {
    server.middlewares.use('/CHANGELOG.md', (_req, res) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(readFileSync('CHANGELOG.md', 'utf-8'));
    });
  },
  closeBundle() {
    copyFileSync('CHANGELOG.md', 'dist/CHANGELOG.md');
  },
};

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/my-smart-finance/' : '/',
  plugins: [react(), changelogPlugin],
  server: {
    host: true, // 允許從區網內其他裝置（如手機）連線
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['chart.js', 'react-chartjs-2'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
}));
