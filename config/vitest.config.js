import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  // 正式 build 走 @vitejs/plugin-react 的 automatic runtime，元件因此不需要 import React；
  // 測試這邊沒掛那個 plugin，不指定就會退回 classic transform，一渲染元件就 React is not defined
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['config/vitest.setup.js'],
    include: ['tests/unit/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/config.js', '**/*.test.js'],
    },
  },
});
