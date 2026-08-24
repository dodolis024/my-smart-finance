import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'coverage/', 'public/', 'node_modules/'] },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // 以 rest 解構「刻意丟棄某個 key」（如 const { savedAt, ...rest } = obj）
      // 是慣用寫法，被丟棄的 sibling 不應被當成未使用變數
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // 刻意吞錯誤的空 catch（如 localStorage 存取失敗）視為合法
      'no-empty': ['error', { allowEmptyCatch: true }],
      // JSX 文字中的全形空格為中文排版刻意使用，放行
      'no-irregular-whitespace': ['error', { skipJSXText: true }],
    },
  },
];
