const CACHE = 'reminders-v13';
const FILES = ['./', './index.html', './manifest.json', './icon-v2.svg'];
const scheduled = {};
const repeats = {};
const SCHED_CACHE = 'sw-schedules';

async function saveSchedule(id, data) {
  try { const c = await caches.open(SCHED_CACHE); await c.put('/s/'+id, new Response(JSON.stringify(data))); } catch {}
}
async function removeSchedule(id) {
  try { const c = await caches.open(SCHED_CACHE); await c.delete('/s/'+id); } catch {}
}
async function restoreSchedules() {
  try {
    const c = await caches.open(SCHED_CACHE);
    const keys = await c.keys();
    const now = Date.now();
    for (const req of keys) {
      const r = await c.match(req);
      if (!r) continue;
      const d = await r.json();
      if (scheduled[d.id]) continue;
      const remaining = d.fireAt - now;
      if (remaining <= 0 && remaining > -10 * 60 * 1000) {
        await c.delete(req);
        fireAndRepeat(d);
      } else if (remaining > 0) {
        scheduled[d.id] = setTimeout(() => {
          delete scheduled[d.id];
          removeSchedule(d.id);
          fireAndRepeat(d);
        }, remaining);
      } else {
        await c.delete(req);
      }
    }
  } catch {}
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'sw-config' && k !== SCHED_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => restoreSchedules())
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
      { action: 'wa',       title: '\u{1F4F1} WhatsApp' }
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

async function sendWA(d) {
  try {
    const cfg = await getConfig();
    if (!cfg.waPhone || !cfg.waApiKey) return;
    const text = encodeURIComponent('⏰ Reminder: ' + (d.title || '') + (d.body && d.body !== 'Time for your reminder!' ? '\n' + d.body : ''));
    await fetch('https://api.callmebot.com/whatsapp.php?phone=' + cfg.waPhone + '&text=' + text + '&apikey=' + cfg.waApiKey);
  } catch {}
}

self.addEventListener('push', e => {
  if (!e.data) return;
  const d = e.data.json();
  e.waitUntil(
    Promise.all([restoreSchedules(), sendWA(d)]).then(() =>
      self.registration.showNotification(d.title, buildOpts(d))
        .then(() => {
          broadcast({ type: 'PUSH_FIRED', data: d });
          scheduleRepeat(d);
        })
    )
  );
});

function fireAndRepeat(d) {
  sendWA(d);
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
        reminders: m.reminders || [],
        waPhone: m.waPhone || '',
        waApiKey: m.waApiKey || ''
      })))
    );
    return;
  }
  if (m.type === 'SHOW') fireAndRepeat(m.data);
  if (m.type === 'SCHEDULE') {
    if (scheduled[m.id]) clearTimeout(scheduled[m.id]);
    const fireAt = Date.now() + m.delay;
    const d = { id: m.id, title: m.title, body: m.body, wa: m.wa, phone: m.phone, autoWa: m.autoWa, fireAt };
    saveSchedule(m.id, d);
    scheduled[m.id] = setTimeout(() => {
      delete scheduled[m.id];
      removeSchedule(m.id);
      fireAndRepeat(d);
    }, m.delay);
  }
  if (m.type === 'CANCEL') {
    if (scheduled[m.id]) { clearTimeout(scheduled[m.id]); delete scheduled[m.id]; }
    removeSchedule(m.id);
    stopRepeat(m.id);
  }
  restoreSchedules();
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
    e.waitUntil(
      getConfig().then(cfg => {
        if (cfg.backendUrl) {
          return fetch(cfg.backendUrl + '/acknowledge', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: d.id })
          }).catch(() => {});
        }
      })
    );
    return;
  }

  if (e.action === 'wa') {
    const phone = (d.autoWa || d.phone || '').replace(/\D/g, '');
    if (phone) {
      const url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent('⏰ Reminder: ' + (d.title || '') + (d.body && d.body !== 'Time for your reminder!' ? '\n' + d.body : ''));
      e.waitUntil(self.clients.openWindow(url));
    }
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
