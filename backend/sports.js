'use strict';
/**
 * Live sports updates over Web Push.
 *
 * Polls ESPN's public scoreboard JSON for the leagues people actually follow,
 * diffs each match against the last snapshot, and pushes only the moments that
 * matter (kick-off, goal, wicket, half-time, full-time) plus an optional
 * periodic score digest.
 *
 * No API key is required. Nothing is installed on the phone: the browser's
 * push service wakes the service worker even when the page is closed.
 */

const webpush = require('web-push');

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

// Leagues verified against ESPN's scoreboard API. Users can also add any other
// ESPN league by id (e.g. "cricket/8082") via /sports/validate.
const LEAGUES = [
  { id: 'soccer/eng.1',            group: 'Football',          label: 'Premier League' },
  { id: 'soccer/esp.1',            group: 'Football',          label: 'LaLiga' },
  { id: 'soccer/ita.1',            group: 'Football',          label: 'Serie A' },
  { id: 'soccer/ger.1',            group: 'Football',          label: 'Bundesliga' },
  { id: 'soccer/fra.1',            group: 'Football',          label: 'Ligue 1' },
  { id: 'soccer/ned.1',            group: 'Football',          label: 'Eredivisie' },
  { id: 'soccer/por.1',            group: 'Football',          label: 'Primeira Liga' },
  { id: 'soccer/eng.2',            group: 'Football',          label: 'Championship (ENG)' },
  { id: 'soccer/eng.fa',           group: 'Football',          label: 'FA Cup' },
  { id: 'soccer/eng.league_cup',   group: 'Football',          label: 'Carabao Cup' },
  { id: 'soccer/uefa.champions',   group: 'Football',          label: 'Champions League' },
  { id: 'soccer/uefa.europa',      group: 'Football',          label: 'Europa League' },
  { id: 'soccer/uefa.europa.conf', group: 'Football',          label: 'Conference League' },
  { id: 'soccer/uefa.nations',     group: 'Football',          label: 'Nations League' },
  { id: 'soccer/fifa.world',       group: 'Football',          label: 'FIFA World Cup' },
  { id: 'soccer/fifa.worldq.uefa', group: 'Football',          label: 'World Cup Qualifying (UEFA)' },
  { id: 'soccer/caf.nations',      group: 'Football',          label: 'Africa Cup of Nations' },
  { id: 'soccer/ind.1',            group: 'Football',          label: 'Indian Super League' },
  { id: 'soccer/usa.1',            group: 'Football',          label: 'MLS' },
  { id: 'soccer/mex.1',            group: 'Football',          label: 'Liga MX' },

  { id: 'cricket/8048',            group: 'Cricket',           label: 'IPL' },
  { id: 'cricket/8039',            group: 'Cricket',           label: 'ICC Cricket World Cup' },
  { id: 'cricket/8037',            group: 'Cricket',           label: 'ICC Champions Trophy' },
  { id: 'cricket/8044',            group: 'Cricket',           label: 'Big Bash League' },
  { id: 'cricket/8043',            group: 'Cricket',           label: 'Sheffield Shield' },
  { id: 'cricket/8050',            group: 'Cricket',           label: 'Ranji Trophy' },
  { id: 'cricket/8052',            group: 'Cricket',           label: 'County Championship' },
  { id: 'cricket/8053',            group: 'Cricket',           label: 'T20 Blast (ENG)' },

  { id: 'basketball/nba',          group: 'Basketball',        label: 'NBA' },
  { id: 'basketball/wnba',         group: 'Basketball',        label: 'WNBA' },
  { id: 'football/nfl',            group: 'American Football', label: 'NFL' },
  { id: 'football/college-football',group: 'American Football', label: 'NCAA Football' },
  { id: 'hockey/nhl',              group: 'Hockey',            label: 'NHL' },
  { id: 'baseball/mlb',            group: 'Baseball',          label: 'MLB' },
];

const LEAGUE_BY_ID = new Map(LEAGUES.map(l => [l.id, l]));
const labelFor = id => (LEAGUE_BY_ID.get(id) || {}).label || id;

const DEFAULT_PREFS = {
  leagues: [],            // ["soccer/eng.1", ...]
  teams: {},              // { "soccer/eng.1": ["382"] } — empty means every match
  events: { start: true, score: true, period: true, final: true },
  digestMinutes: 0,       // 0 = off, else summary of live followed matches every N min
  enabled: true,
};

// ---------------------------------------------------------------- HTTP helper

async function getJson(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'live-sports-push/1.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------- normalisation

function normalizeEvent(leagueId, ev) {
  const sport = leagueId.split('/')[0];
  const comp = (ev.competitions || [])[0] || {};
  const st = comp.status || ev.status || {};
  const type = st.type || {};

  const teams = (comp.competitors || []).map(c => {
    const t = c.team || {};
    const lines = Array.isArray(c.linescores) ? c.linescores : [];
    const cur = lines.find(l => l.isCurrent) || lines[lines.length - 1] || null;
    return {
      id: String(t.id || c.id || ''),
      abbr: t.abbreviation || t.shortDisplayName || t.displayName || '?',
      name: t.displayName || t.name || '?',
      logo: t.logo || '',
      home: c.homeAway === 'home',
      score: c.score === undefined || c.score === null ? '' : String(c.score).trim(),
      wickets: cur && cur.isBatting ? Number(cur.wickets || 0) : null,
      batting: !!(cur && cur.isBatting),
    };
  });

  return {
    id: String(ev.id),
    league: leagueId,
    leagueLabel: labelFor(leagueId),
    sport,
    name: ev.shortName || ev.name || teams.map(t => t.abbr).join(' v '),
    date: ev.date || comp.date || null,
    state: type.state || 'pre',                                  // pre | in | post
    desc: type.description || '',                                // "In Progress", "Halftime", ...
    detail: type.shortDetail || type.detail || type.description || '',
    clock: st.displayClock && st.displayClock !== "0'" ? st.displayClock : '',
    period: Number(st.period || 0),
    summary: st.summary || '',
    teams,
  };
}

async function fetchLeague(leagueId) {
  const json = await getJson(`${ESPN}/${leagueId}/scoreboard`);
  // Out-of-season leagues return placeholder entries like [{}] — drop anything
  // without an id and two named sides.
  return (json.events || [])
    .filter(ev => ev && ev.id)
    .map(ev => normalizeEvent(leagueId, ev))
    .filter(ev => ev.teams.length >= 2);
}

const liveCache = new Map(); // leagueId -> { at, events }

async function leagueEvents(leagueId, maxAgeMs = 20000) {
  const hit = liveCache.get(leagueId);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.events;
  const events = await fetchLeague(leagueId);
  liveCache.set(leagueId, { at: Date.now(), events });
  return events;
}

// ------------------------------------------------------------------ wording

function scoreline(ev) {
  const t = ev.teams;
  if (t.length < 2) return ev.name;
  if (ev.sport === 'cricket') {
    // ESPN already hands cricket a display string: "348 & 19/0 (5.1 ov)"
    const parts = t.map(x => `${x.abbr} ${x.score || '—'}`.trim());
    return parts.join('  |  ');
  }
  const home = t.find(x => x.home) || t[0];
  const away = t.find(x => !x.home) || t[1];
  return `${home.abbr} ${home.score || 0} – ${away.score || 0} ${away.abbr}`;
}

const matchup = ev => (ev.teams.length >= 2 ? ev.teams.map(t => t.abbr).join(' v ') : ev.name);

const BREAK_RE = /half|end of|break|innings|interval|delay|suspend|rain|postpon|overtime|shootout|penalt/i;
const isBreak = desc => !!desc && !/^in progress$/i.test(desc) && BREAK_RE.test(desc);

function scoreKey(ev) {
  return ev.teams.map(t => t.score).join('|');
}

function snapshotOf(ev) {
  return {
    state: ev.state,
    desc: ev.desc,
    period: ev.period,
    scores: ev.teams.map(t => t.score),
    wickets: ev.teams.map(t => t.wickets),
  };
}

function whoScored(prev, ev) {
  for (let i = 0; i < ev.teams.length; i++) {
    const before = Number(prev.scores[i]);
    const after = Number(ev.teams[i].score);
    if (Number.isFinite(before) && Number.isFinite(after) && after > before) return ev.teams[i].name;
  }
  return '';
}

/**
 * Compare a match against its previous snapshot and return the alerts worth
 * a buzz. Per-sport policy keeps this from becoming a firehose: football gets
 * every goal, cricket gets every wicket and innings, the high-scoring American
 * sports get period ends and the final only (running score goes in the digest).
 */
function diffEvent(prev, ev) {
  const out = [];
  const league = ev.leagueLabel;

  if (prev.state === 'pre' && ev.state === 'in') {
    out.push({ kind: 'start', head: `🔴 Underway: ${matchup(ev)}`, sub: `${scoreline(ev)} · ${league}` });
  }

  if (prev.state === 'in' && ev.state === 'in') {
    if (ev.sport === 'soccer' && scoreKey(ev) !== prev.scores.join('|')) {
      const scorer = whoScored(prev, ev);
      out.push({
        kind: 'score',
        head: `⚽ ${scoreline(ev)}`,
        sub: `${scorer ? 'Goal — ' + scorer : 'Goal'}${ev.clock ? ' ' + ev.clock : ''} · ${league}`,
      });
    }

    if (ev.sport === 'cricket') {
      const gotWicket = ev.teams.some((t, i) => {
        const before = prev.wickets ? prev.wickets[i] : null;
        return t.wickets !== null && before !== null && before !== undefined && t.wickets > before;
      });
      if (gotWicket) {
        out.push({ kind: 'score', head: `🏏 Wicket! ${scoreline(ev)}`, sub: `${ev.detail || ''} · ${league}`.trim() });
      } else if (ev.period !== prev.period && ev.period > 0) {
        out.push({ kind: 'period', head: `🏏 Innings ${ev.period}: ${scoreline(ev)}`, sub: league });
      }
    }

    const alreadyFlaggedBreak = out.some(a => a.kind === 'period');
    if (!alreadyFlaggedBreak && ev.desc !== prev.desc && isBreak(ev.desc)) {
      out.push({ kind: 'period', head: `⏸ ${ev.desc}: ${scoreline(ev)}`, sub: league });
    }
  }

  if (prev.state !== 'post' && ev.state === 'post') {
    out.push({ kind: 'final', head: `🏁 ${scoreline(ev)}`, sub: `${ev.detail || 'Final'} · ${league}` });
  }

  return out;
}

// --------------------------------------------------------------- team lists

const teamCache = new Map(); // leagueId -> { at, teams }

async function leagueTeams(leagueId) {
  const hit = teamCache.get(leagueId);
  if (hit && Date.now() - hit.at < 12 * 60 * 60 * 1000) return hit.teams;

  let teams = [];
  try {
    const json = await getJson(`${ESPN}/${leagueId}/teams`);
    const list = (((json.sports || [])[0] || {}).leagues || [])[0] || {};
    teams = (list.teams || [])
      .map(w => w.team || w)
      .map(t => ({ id: String(t.id), abbr: t.abbreviation || t.shortDisplayName || '', name: t.displayName || t.name, logo: t.logo || '' }));
  } catch {
    teams = [];
  }

  if (!teams.length) {
    // Cricket (and some cup competitions) have no /teams endpoint — fall back to
    // whoever appears on the current scoreboard.
    try {
      const events = await leagueEvents(leagueId, 60 * 60 * 1000);
      const seen = new Map();
      events.forEach(e => e.teams.forEach(t => { if (t.id && !seen.has(t.id)) seen.set(t.id, { id: t.id, abbr: t.abbr, name: t.name, logo: t.logo }); }));
      teams = [...seen.values()];
    } catch { /* leave empty */ }
  }

  teams.sort((a, b) => a.name.localeCompare(b.name));
  teamCache.set(leagueId, { at: Date.now(), teams });
  return teams;
}

// -------------------------------------------------------------- the poller

function createSportsService({ store, persist, pollSeconds = 60 }) {
  store.sportsSubs = store.sportsSubs || {};   // userId -> { subscription, prefs, lastDigest }
  store.sportsSnap = store.sportsSnap || {};   // leagueId -> { eventId -> snapshot }

  const followedLeagues = () => {
    const set = new Set();
    for (const rec of Object.values(store.sportsSubs)) {
      if (!rec || !rec.prefs || rec.prefs.enabled === false) continue;
      (rec.prefs.leagues || []).forEach(l => set.add(l));
    }
    return [...set];
  };

  function follows(prefs, ev) {
    if (!(prefs.leagues || []).includes(ev.league)) return false;
    const picked = (prefs.teams || {})[ev.league] || [];
    if (!picked.length) return true;
    return ev.teams.some(t => picked.includes(t.id));
  }

  const wants = (prefs, kind) => (prefs.events || DEFAULT_PREFS.events)[kind] !== false;

  async function send(userId, payload) {
    const rec = store.sportsSubs[userId];
    if (!rec || !rec.subscription) return false;
    try {
      await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('[sports] push failed', e.statusCode || e.message, userId);
      if (e.statusCode === 404 || e.statusCode === 410) {
        delete store.sportsSubs[userId];
        persist();
      }
      return false;
    }
  }

  let polling = false;

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const leagues = followedLeagues();
      if (!leagues.length) return;

      const alertsByLeague = {};   // leagueId -> [{ ev, alerts }]
      const liveByLeague = {};     // leagueId -> events (for digests)
      let dirty = false;

      for (const leagueId of leagues) {
        let events;
        try {
          events = await fetchLeague(leagueId);
          liveCache.set(leagueId, { at: Date.now(), events });
        } catch (e) {
          console.error('[sports] fetch failed', leagueId, e.message);
          continue;
        }
        liveByLeague[leagueId] = events;

        const seeded = !!store.sportsSnap[leagueId];
        const prevSnaps = store.sportsSnap[leagueId] || {};
        const nextSnaps = {};
        const found = [];

        for (const ev of events) {
          const prev = prevSnaps[ev.id];
          nextSnaps[ev.id] = snapshotOf(ev);
          // First time we see a league (fresh deploy, new follow) we only record
          // the baseline — otherwise everyone gets a burst of stale "goals".
          if (seeded && prev) {
            const alerts = diffEvent(prev, ev);
            if (alerts.length) found.push({ ev, alerts });
          }
        }

        store.sportsSnap[leagueId] = nextSnaps;
        dirty = true;
        if (found.length) alertsByLeague[leagueId] = found;
      }

      // Fan out to each subscriber.
      for (const [userId, rec] of Object.entries(store.sportsSubs)) {
        if (!rec || rec.prefs?.enabled === false) continue;
        const prefs = { ...DEFAULT_PREFS, ...(rec.prefs || {}) };
        const mine = [];

        for (const leagueId of prefs.leagues || []) {
          for (const { ev, alerts } of alertsByLeague[leagueId] || []) {
            if (!follows(prefs, ev)) continue;
            const keep = alerts.filter(a => wants(prefs, a.kind));
            if (keep.length) mine.push({ ev, alerts: keep });
          }
        }

        // One notification per match (newest state wins), at most 3 per cycle.
        for (const { ev, alerts } of mine.slice(0, 3)) {
          const a = alerts[alerts.length - 1];
          const extra = alerts.length > 1 ? alerts.slice(0, -1).map(x => x.head).join(' · ') : '';
          await send(userId, {
            kind: 'sports',
            title: a.head,
            body: extra ? `${a.sub}\n${extra}` : a.sub,
            tag: 'match:' + ev.id,
            url: '/sports.html',
          });
        }
        if (mine.length > 3) {
          await send(userId, {
            kind: 'sports',
            title: `+${mine.length - 3} more updates`,
            body: mine.slice(3).map(m => m.alerts[m.alerts.length - 1].head).join('\n'),
            tag: 'sports:overflow',
            url: '/sports.html',
          });
        }

        // Periodic score digest for the sports whose running score changes
        // constantly (basketball, cricket chases, American football).
        const every = Number(prefs.digestMinutes || 0);
        if (every > 0) {
          const due = !rec.lastDigest || Date.now() - rec.lastDigest >= every * 60 * 1000;
          if (due) {
            const live = [];
            for (const leagueId of prefs.leagues || []) {
              for (const ev of liveByLeague[leagueId] || []) {
                if (ev.state === 'in' && follows(prefs, ev)) live.push(ev);
              }
            }
            if (live.length) {
              const lines = live.slice(0, 5).map(ev => `${scoreline(ev)}${ev.clock ? ' (' + ev.clock + ')' : ''}`);
              const ok = await send(userId, {
                kind: 'sports',
                title: live.length === 1 ? scoreline(live[0]) : `${live.length} matches live`,
                body: live.length === 1 ? `${live[0].detail} · ${live[0].leagueLabel}` : lines.join('\n'),
                tag: 'sports:digest',
                url: '/sports.html',
              });
              if (ok) { rec.lastDigest = Date.now(); dirty = true; }
            }
          }
        }
      }

      if (dirty) {
        // Drop snapshots for leagues nobody follows any more.
        for (const leagueId of Object.keys(store.sportsSnap)) {
          if (!leagues.includes(leagueId)) delete store.sportsSnap[leagueId];
        }
        persist();
      }
    } catch (e) {
      console.error('[sports] poll error', e.message);
    } finally {
      polling = false;
    }
  }

  function start() {
    setInterval(poll, Math.max(20, pollSeconds) * 1000);
    setTimeout(poll, 5000);
    console.log(`[sports] poller every ${pollSeconds}s`);
  }

  // ----------------------------------------------------------------- routes

  function register(app) {
    app.get('/sports/leagues', (_req, res) => res.json({ leagues: LEAGUES }));

    app.get('/sports/teams', async (req, res) => {
      const league = String(req.query.league || '');
      if (!league) return res.status(400).json({ error: 'missing league' });
      try {
        res.json({ league, teams: await leagueTeams(league) });
      } catch (e) {
        res.status(502).json({ error: e.message });
      }
    });

    app.get('/sports/live', async (req, res) => {
      const ids = String(req.query.leagues || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
      if (!ids.length) return res.json({ events: [] });
      const out = [];
      await Promise.all(ids.map(async id => {
        try { out.push(...(await leagueEvents(id))); } catch { /* skip league */ }
      }));
      const rank = { in: 0, pre: 1, post: 2 };
      out.sort((a, b) => (rank[a.state] - rank[b.state]) || String(a.date).localeCompare(String(b.date)));
      res.json({ events: out, at: new Date().toISOString() });
    });

    app.get('/sports/validate', async (req, res) => {
      const league = String(req.query.league || '').replace(/^\/+|\/+$/g, '');
      if (!/^[a-z-]+\/[a-z0-9._-]+$/i.test(league)) return res.status(400).json({ ok: false, error: 'expected sport/league, e.g. cricket/8048' });
      try {
        const json = await getJson(`${ESPN}/${league}/scoreboard`);
        const name = ((json.leagues || [])[0] || {}).name;
        if (!name) return res.status(404).json({ ok: false, error: 'no such league' });
        res.json({ ok: true, league, label: name, events: (json.events || []).length });
      } catch (e) {
        res.status(404).json({ ok: false, error: e.message });
      }
    });

    app.post('/sports/subscribe', (req, res) => {
      const { userId, subscription, prefs } = req.body || {};
      if (!userId || !subscription) return res.status(400).json({ error: 'missing fields' });
      const existing = store.sportsSubs[userId] || {};
      store.sportsSubs[userId] = {
        ...existing,
        subscription,
        prefs: { ...DEFAULT_PREFS, ...(existing.prefs || {}), ...(prefs || {}) },
      };
      persist();
      res.json({ ok: true, prefs: store.sportsSubs[userId].prefs });
    });

    app.post('/sports/prefs', (req, res) => {
      const { userId, prefs } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'missing userId' });
      const rec = store.sportsSubs[userId];
      if (!rec) return res.status(404).json({ error: 'not subscribed' });
      rec.prefs = { ...DEFAULT_PREFS, ...(rec.prefs || {}), ...(prefs || {}) };
      persist();
      res.json({ ok: true, prefs: rec.prefs });
    });

    app.get('/sports/prefs', (req, res) => {
      const rec = store.sportsSubs[String(req.query.userId || '')];
      res.json({ subscribed: !!rec, prefs: rec ? rec.prefs : DEFAULT_PREFS });
    });

    app.post('/sports/unsubscribe', (req, res) => {
      const { userId } = req.body || {};
      if (userId && store.sportsSubs[userId]) { delete store.sportsSubs[userId]; persist(); }
      res.json({ ok: true });
    });

    app.post('/sports/test', async (req, res) => {
      const { userId } = req.body || {};
      if (!userId || !store.sportsSubs[userId]) return res.status(404).json({ error: 'not subscribed' });
      const ok = await send(userId, {
        kind: 'sports',
        title: '✅ Live sports updates are on',
        body: 'This is how goals, wickets and final scores will arrive — even with the page closed.',
        tag: 'sports:test',
        url: '/sports.html',
      });
      res.json({ ok });
    });

    app.post('/sports/poll-now', async (_req, res) => { await poll(); res.json({ ok: true }); });
  }

  return { register, start, poll, leagueEvents, leagueTeams };
}

module.exports = { createSportsService, LEAGUES, normalizeEvent, diffEvent, snapshotOf, scoreline, DEFAULT_PREFS };
