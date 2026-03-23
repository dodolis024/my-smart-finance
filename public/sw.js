// Smart Finance — Service Worker
// 負責接收 Web Push 通知並顯示系統推播

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
