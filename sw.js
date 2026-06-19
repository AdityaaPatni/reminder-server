const CACHE = 'reminders-v5';
const FILES = ['./', './index.html', './manifest.json', './icon.svg'];
const scheduled = {};
const repeats = {};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

function buildOpts(d, bodyOverride) {
  return {
    body: bodyOverride || d.body || 'Time for your reminder!',
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 400, 150, 600],
    tag: d.id,
    renotify: true,
    data: d,
    actions: [
      { action: 'snooze',  title: '\u{1F4A4} Snooze 5 min' },
      { action: 'dismiss', title: '✕ Dismiss' }
    ]
  };
}

// Handle push from server — fires even when app is killed
self.addEventListener('push', e => {
  if (!e.data) return;
  const d = e.data.json();
  e.waitUntil(
    self.registration.showNotification(d.title, buildOpts(d))
      .then(() => {
        broadcast({ type: 'PUSH_FIRED', data: d });
        scheduleRepeat(d);
      })
  );
});

function fireAndRepeat(d) {
  self.registration.showNotification(d.title, buildOpts(d));
  scheduleRepeat(d);
}

function scheduleRepeat(d) {
  stopRepeat(d.id);
  repeats[d.id] = setTimeout(() => {
    delete repeats[d.id];
    self.registration.showNotification('⏰ ' + d.title, buildOpts(d, 'Still waiting—tap to dismiss.'));
    scheduleRepeat(d);
  }, 5 * 60 * 1000);
}

function stopRepeat(id) {
  if (repeats[id]) { clearTimeout(repeats[id]); delete repeats[id]; }
}

self.addEventListener('message', e => {
  if (!e.data) return;
  const m = e.data;
  if (m.type === 'SHOW') fireAndRepeat(m.data);
  if (m.type === 'SCHEDULE') {
    if (scheduled[m.id]) clearTimeout(scheduled[m.id]);
    scheduled[m.id] = setTimeout(() => {
      delete scheduled[m.id];
      fireAndRepeat({ id: m.id, title: m.title, body: m.body, wa: m.wa, phone: m.phone });
    }, m.delay);
  }
  if (m.type === 'CANCEL') {
    if (scheduled[m.id]) { clearTimeout(scheduled[m.id]); delete scheduled[m.id]; }
    stopRepeat(m.id);
  }
});

self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  e.notification.close();
  stopRepeat(d.id);

  if (e.action === 'snooze') {
    if (scheduled[d.id]) clearTimeout(scheduled[d.id]);
    scheduled[d.id] = setTimeout(() => {
      delete scheduled[d.id];
      fireAndRepeat(d);
    }, 5 * 60 * 1000);
    broadcast({ type: 'SNOOZED', id: d.id });
    return;
  }
  if (e.action === 'dismiss') {
    broadcast({ type: 'DISMISSED', id: d.id });
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const win = list.find(c => 'focus' in c);
      if (win) { win.focus(); win.postMessage({ type: 'NOTIF_TAPPED', data: d }); return; }
      return self.clients.openWindow('./');
    })
  );
});

function broadcast(msg) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(list => list.forEach(c => c.postMessage(msg)));
}
