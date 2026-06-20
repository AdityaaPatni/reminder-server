const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

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

// Persistent storage (filesystem persists on Render between restarts)
const DATA_PATH = path.join(__dirname, '.data');
let store = { subs: {}, reminders: [] };
if (fs.existsSync(DATA_PATH)) {
  try { store = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch {}
}
function persist() {
  try { fs.writeFileSync(DATA_PATH, JSON.stringify(store)); } catch {}
}

// Routes
app.get('/health', (_, res) => res.json({ ok: true, reminders: store.reminders.length }));

app.get('/vapid-public-key', (_, res) => res.json({ key: vapid.publicKey }));

app.post('/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'missing fields' });
  store.subs[userId] = subscription;
  persist();
  res.json({ ok: true });
});

// Client sends all pending reminders; server replaces them for this user
app.post('/sync', (req, res) => {
  const { userId, reminders } = req.body;
  if (!userId) return res.status(400).json({ error: 'missing userId' });
  store.reminders = store.reminders.filter(r => r.userId !== userId);
  if (Array.isArray(reminders)) {
    reminders.forEach(r => store.reminders.push({ ...r, userId, fired: false }));
  }
  persist();
  res.json({ ok: true, queued: reminders?.length ?? 0 });
});

app.delete('/reminder/:id', (req, res) => {
  store.reminders = store.reminders.filter(r => r.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// Cron: check for due reminders every minute
cron.schedule('* * * * *', async () => {
  const now = Date.now();
  let dirty = false;
  for (const r of store.reminders) {
    if (r.fired || new Date(r.date).getTime() > now) continue;
    const sub = store.subs[r.userId];
    if (!sub) { r.fired = true; dirty = true; continue; }
    try {
      await webpush.sendNotification(sub, JSON.stringify({
        title: r.title,
        body: r.notes || 'Time for your reminder!',
        id: r.id,
        wa: r.wa,
        phone: r.phone,
      }));
      r.fired = true;
      dirty = true;
      console.log(`[${new Date().toLocaleTimeString()}] Fired: ${r.title}`);
    } catch (e) {
      console.error('Push error:', e.statusCode, r.id);
      if (e.statusCode === 410 || e.statusCode === 404) {
        delete store.subs[r.userId];
        r.fired = true;
        dirty = true;
      }
    }
  }
  if (dirty) {
    store.reminders = store.reminders.filter(
      r => !r.fired || Date.now() - new Date(r.date).getTime() < 86400000
    );
    persist();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Reminder push server on port ${PORT}`);
  // Self-ping every 10 min to prevent Render free tier sleep
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    setInterval(() => fetch(selfUrl + '/health').catch(() => {}), 10 * 60 * 1000);
    console.log('Self-ping enabled:', selfUrl);
  }
});
