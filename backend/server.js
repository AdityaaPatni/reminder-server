const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// VAPID keys — read from env vars (set these in Render dashboard to persist across redeploys)
const KEYS_PATH = path.join(__dirname, '.vapid');
let vapid;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (fs.existsSync(KEYS_PATH)) {
  vapid = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
} else {
  vapid = webpush.generateVAPIDKeys();
  try { fs.writeFileSync(KEYS_PATH, JSON.stringify(vapid)); } catch {}
  console.log('\n=== SAVE THESE AS RENDER ENV VARS TO AVOID RE-SUBSCRIBING ON REDEPLOY ===');
  console.log('VAPID_PUBLIC_KEY  =', vapid.publicKey);
  console.log('VAPID_PRIVATE_KEY =', vapid.privateKey);
  console.log('========================================================================\n');
}
webpush.setVapidDetails('mailto:adityapatni.patni@gmail.com', vapid.publicKey, vapid.privateKey);

// Persistent storage
const DATA_PATH = path.join(__dirname, '.data');
let store = { subs: {}, reminders: [] };
if (fs.existsSync(DATA_PATH)) {
  try { store = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch {}
}
function persist() {
  try { fs.writeFileSync(DATA_PATH, JSON.stringify(store)); } catch {}
}

const REPEAT_INTERVAL = 2 * 60 * 1000; // re-push every 2 minutes until acknowledged
const MAX_REPEAT_HOURS = 1;             // stop after 1 hour regardless

app.get('/health', (_, res) => res.json({ ok: true, reminders: store.reminders.length }));
app.get('/vapid-public-key', (_, res) => res.json({ key: vapid.publicKey }));

app.post('/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'missing fields' });
  store.subs[userId] = subscription;
  persist();
  res.json({ ok: true });
});

app.post('/sync', (req, res) => {
  const { userId, reminders } = req.body;
  if (!userId) return res.status(400).json({ error: 'missing userId' });
  store.reminders = store.reminders.filter(r => r.userId !== userId);
  if (Array.isArray(reminders)) {
    reminders.forEach(r => store.reminders.push({ ...r, userId, acknowledged: false, lastFired: null }));
  }
  persist();
  res.json({ ok: true, queued: reminders?.length ?? 0 });
});

app.delete('/reminder/:id', (req, res) => {
  store.reminders = store.reminders.filter(r => r.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// Dismiss — stop repeating this reminder
app.post('/acknowledge', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'missing id' });
  const r = store.reminders.find(r => r.id === id);
  if (r) { r.acknowledged = true; persist(); }
  res.json({ ok: true });
});

app.post('/snooze', (req, res) => {
  const { id, minutes = 5 } = req.body;
  if (!id) return res.status(400).json({ error: 'missing id' });
  const r = store.reminders.find(r => r.id === id);
  if (!r) return res.status(404).json({ error: 'not found' });
  r.date = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  r.fired = false;
  r.acknowledged = false;
  r.lastFired = null;
  persist();
  res.json({ ok: true, newDate: r.date });
});

// Cron: every minute — fire due reminders and re-fire unacknowledged ones
cron.schedule('* * * * *', async () => {
  const now = Date.now();
  let dirty = false;
  for (const r of store.reminders) {
    if (r.acknowledged) continue;
    const dueTime = new Date(r.date).getTime();
    if (dueTime > now) continue;
    // Stop repeating after MAX_REPEAT_HOURS
    if (now - dueTime > MAX_REPEAT_HOURS * 60 * 60 * 1000) {
      r.acknowledged = true; dirty = true; continue;
    }
    // Skip if fired recently (within repeat interval)
    if (r.lastFired && now - r.lastFired < REPEAT_INTERVAL) continue;

    const sub = store.subs[r.userId];
    if (!sub) { r.acknowledged = true; dirty = true; continue; }
    try {
      const isRepeat = !!r.lastFired;
      await webpush.sendNotification(sub, JSON.stringify({
        title: isRepeat ? '⏰ ' + r.title : r.title,
        body: isRepeat ? 'Still waiting — tap to dismiss.' : (r.notes || 'Time for your reminder!'),
        id: r.id,
        wa: r.wa,
        phone: r.phone,
      }));
      r.lastFired = now;
      r.fired = true;
      dirty = true;
      console.log(`[${new Date().toLocaleTimeString()}] ${isRepeat ? 'Repeat' : 'Fired'}: ${r.title}`);
    } catch (e) {
      console.error('Push error:', e.statusCode, r.id);
      if (e.statusCode === 410 || e.statusCode === 404) {
        delete store.subs[r.userId];
        r.acknowledged = true;
        dirty = true;
      }
    }
  }
  if (dirty) {
    store.reminders = store.reminders.filter(
      r => !r.acknowledged || now - new Date(r.date).getTime() < 86400000
    );
    persist();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Reminder push server on port ${PORT}`);
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    setInterval(() => fetch(selfUrl + '/health').catch(() => {}), 10 * 60 * 1000);
    console.log('Self-ping enabled:', selfUrl);
  }
});
