import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/my-smart-finance/',
  plugins: [react()],
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
});
