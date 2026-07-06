import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

import '@/styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// 啟動時註冊 Service Worker(App Shell 離線快取 + 推播)
// 僅在 PROD 註冊,避免 dev 環境快取干擾 Vite HMR
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  });
}
