const CACHE = 'reminder-v1';
const FILES = ['./', './index.html', './manifest.json', './icon.svg'];
const scheduled = {};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SHOW') {
    self.registration.showNotification(e.data.title, e.data.opts || {});
  }

  if (e.data.type === 'SCHEDULE') {
    const { id, title, body, delay } = e.data;
    if (scheduled[id]) clearTimeout(scheduled[id]);
    scheduled[id] = setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        requireInteraction: true,
        vibrate: [400, 150, 400, 150, 400, 150, 600],
        tag: id,
        renotify: true
      });
      delete scheduled[id];
    }, delay);
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length) return list[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
