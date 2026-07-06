// Smart Finance — Service Worker
// 1. App Shell 離線快取(導航 network-first、hashed assets cache-first)
// 2. 接收 Web Push 通知並顯示系統推播

// 只在快取「策略」改變時 bump;hashed assets 檔名自帶版本,不需隨版本更新
const CACHE_NAME = 'sf-shell-v1';
// 依 SW 所在路徑推導 base(prod 為 /my-smart-finance/,dev 為 /)
const BASE = self.location.pathname.replace(/sw\.js$/, '');
// 導航回應一律存在固定 key,離線深層連結直接回這份 App Shell
const INDEX_KEY = BASE + 'index.html';
const MAX_ASSET_ENTRIES = 60;

// install 階段預快取 App Shell:首次載入時 SW 尚未接管頁面,
// 導航與入口 assets 不會經過 fetch handler,不預快取的話「裝好就斷網」仍會白屏
async function precacheShell() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch(BASE, { cache: 'no-cache' });
    if (!response.ok) return;
    await cache.put(INDEX_KEY, response.clone());

    // 從 index.html 撈出入口 assets(script/css/modulepreload)一併快取
    const html = await response.text();
    const assetUrls = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => m[1]);
    await Promise.all(
      assetUrls.map(async (url) => {
        try {
          const res = await fetch(url);
          if (res.ok) await cache.put(url, res);
        } catch {
          // 個別 asset 抓不到不阻擋安裝
        }
      })
    );
  } catch {
    // 預快取失敗不阻擋安裝,後續導航(network-first)會再補上
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // 清掉舊版策略的快取
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('sf-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      ),
    ])
  );
});

// 導航:network-first,線上永遠拿最新 HTML,離線回退快取的 App Shell
async function handleNavigate(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(INDEX_KEY, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(INDEX_KEY);
    return cached || Response.error();
  }
}

// hashed assets:cache-first,內容不可變,命中即回
async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
    pruneAssets(cache);
  }
  return response;
}

// 舊版 assets 會隨部署累積,超量時刪最舊的(keys() 為寫入順序)
async function pruneAssets(cache) {
  const keys = await cache.keys();
  const assetKeys = keys.filter((req) => new URL(req.url).pathname.startsWith(BASE + 'assets/'));
  if (assetKeys.length <= MAX_ASSET_ENTRIES) return;
  await Promise.all(
    assetKeys.slice(0, assetKeys.length - MAX_ASSET_ENTRIES).map((req) => cache.delete(req))
  );
}

// 靜態資源:stale-while-revalidate,先回快取再背景更新
async function handleStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 非同源(含所有 Supabase 請求)一律不攔截、不快取
  if (url.origin !== self.location.origin) return;

  // CHANGELOG 曾在 iOS PWA 被快取卡住(見 vite.config.js),與 sw.js 本身永遠走網路
  if (/CHANGELOG.*\.md$/.test(url.pathname) || url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }

  if (url.pathname.startsWith(BASE + 'assets/')) {
    event.respondWith(handleAsset(request));
    return;
  }

  if (
    url.pathname.includes('/favicons/') ||
    url.pathname.includes('/images/') ||
    url.pathname.endsWith('site.webmanifest')
  ) {
    event.respondWith(handleStatic(request));
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Smart Finance', body: event.data.text() };
  }

  const { title = 'Smart Finance', body = '', icon, badge, url } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/my-smart-finance/favicons/web-app-manifest-192x192.png',
      badge: badge || '/my-smart-finance/favicons/favicon-96x96.png',
      data: { url: url || '/my-smart-finance/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/my-smart-finance/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 若已有開啟的視窗，直接 focus
      for (const client of clientList) {
        if (client.url.includes('/my-smart-finance/') && 'focus' in client) {
          return client.focus();
        }
      }
      // 否則開新視窗
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
