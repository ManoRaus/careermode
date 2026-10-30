self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Career Mode', {
    body: payload.body || 'Você tem um lembrete pendente.',
    icon: './logo-192.png',
    badge: './logo-192.png',
    tag: payload.tag || 'career-mode-reminder',
    renotify: true,
    data: { url: payload.url || './' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';
  event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then((clientList) => {
    for (const client of clientList) {
      if ('focus' in client) {
        if ('navigate' in client) client.navigate(targetUrl);
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  }));
});
