/* Service worker: receives Web Push while the page is closed or killed. */

const ICON = '/icon-192.png';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (_) {
    d = { title: 'Update', body: event.data ? event.data.text() : '' };
  }

  const title = d.title || 'Live update';
  const options = {
    body: d.body || '',
    icon: d.icon || ICON,
    badge: d.badge || ICON,
    tag: d.tag || 'update',
    renotify: true,                       // buzz again even when the tag is reused
    vibrate: [120, 60, 120],
    timestamp: Date.now(),
    data: { url: d.url || '/sports.html', id: d.id || null, kind: d.kind || 'generic' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/sports.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(url.split('?')[0]) && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

// If the push service drops a subscription, ask any open page to re-register.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    all.forEach(c => c.postMessage({ type: 'resubscribe' }));
  })());
});
