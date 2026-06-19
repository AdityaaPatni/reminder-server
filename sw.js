const CACHE = 'reminders-v10';
const FILES = ['./', './index.html', './manifest.json', './icon-v2.svg'];
const scheduled = {};
const repeats = {};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'sw-config').map(k => caches.delete(k))))
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
    vibrate: [400,100,400,100,400,100,400,100,400,100,400,100,400,100,400,100,
              600,150,600,150,600,150,600,150,
              1000,200,1000,200,1000,200,1000,200,1000],
    tag: d.id,
    renotify: true,
    data: d,
    actions: [
      { action: 'snooze5',  title: '\u{1F4A4} 5m' },
      { action: 'snooze15', title: '\u{1F4A4} 15m' },
      { action: 'dismiss',  title: '✕ Done' }
    ]
  };
}

async function getConfig() {
  try {
    const c = await caches.open('sw-config');
    const r = await c.match('/sw-config');
    if (r) return r.json();
  } catch {}
  return {};
}

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
    self.registration.showNotification('⏰ ' + d.title, buildOpts(d, 'Still waiting — tap to open.'));
    scheduleRepeat(d);
  }, 2 * 60 * 1000);
}

function stopRepeat(id) {
  if (repeats[id]) { clearTimeout(repeats[id]); delete repeats[id]; }
}

self.addEventListener('message', e => {
  if (!e.data) return;
  const m = e.data;
  if (m.type === 'SET_CONFIG') {
    caches.open('sw-config').then(c =>
      c.put('/sw-config', new Response(JSON.stringify({
        backendUrl: m.backendUrl,
        userId: m.userId,
        reminders: m.reminders || []
      })))
    );
    return;
  }
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

  if (e.action === 'snooze5' || e.action === 'snooze15' || e.action === 'snooze') {
    const snoozeMin = e.action === 'snooze15' ? 15 : 5;
    const snoozeMs = snoozeMin * 60 * 1000;
    broadcast({ type: 'SNOOZED', id: d.id, minutes: snoozeMin });
    e.waitUntil(
      getConfig().then(cfg => {
        if (!cfg.backendUrl || !cfg.userId) {
          scheduled[d.id] = setTimeout(() => { delete scheduled[d.id]; fireAndRepeat(d); }, snoozeMs);
          return;
        }
        const now = Date.now();
        const snoozeDate = new Date(now + snoozeMs).toISOString();
        let reminders = (cfg.reminders || []).map(r =>
          r.id === d.id ? { ...r, date: snoozeDate, fired: false } : r
        );
        if (!reminders.find(r => r.id === d.id)) {
          reminders.push({ ...d, date: snoozeDate, fired: false });
        }
        const pending = reminders.filter(r => {
          if (r.fired && (!r.repeat || r.repeat === 'none')) return false;
          return new Date(r.date).getTime() > now - 60000;
        });
        return fetch(cfg.backendUrl + '/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: cfg.userId, reminders: pending })
        }).catch(() => {
          scheduled[d.id] = setTimeout(() => { delete scheduled[d.id]; fireAndRepeat(d); }, snoozeMs);
        });
      })
    );
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
