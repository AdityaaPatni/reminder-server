'use strict';
/**
 * Live cricket and football updates over Web Push.
 *
 * Two tiers of data:
 *   1. Scoreboard (one request per league) — who is playing, the score, and the
 *      pre -> live -> finished transitions.
 *   2. Detail feed (one request per live match, see sportsDetail.js) — the
 *      moments inside a match: goals with scorers, red cards, substitutions,
 *      wickets, batting milestones.
 *
 * Tier 2 is preferred; if it fails the scoreboard still produces goal/wicket
 * alerts on its own, so a bad request degrades instead of going silent.
 *
 * Polling speeds up to every 20s while a followed match is live and drops back
 * to every 3 minutes when nothing is on.
 */

const webpush = require('web-push');
const detail = require('./sportsDetail');
const { createDiscovery } = require('./discover');

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

const LEAGUES = [
  { id: 'soccer/eng.1',            group: 'Football',        label: 'Premier League' },
  { id: 'soccer/esp.1',            group: 'Football',        label: 'LaLiga' },
  { id: 'soccer/ita.1',            group: 'Football',        label: 'Serie A' },
  { id: 'soccer/ger.1',            group: 'Football',        label: 'Bundesliga' },
  { id: 'soccer/fra.1',            group: 'Football',        label: 'Ligue 1' },
  { id: 'soccer/ned.1',            group: 'Football',        label: 'Eredivisie' },
  { id: 'soccer/por.1',            group: 'Football',        label: 'Primeira Liga' },
  { id: 'soccer/eng.2',            group: 'Football',        label: 'Championship (ENG)' },
  { id: 'soccer/eng.fa',           group: 'Football',        label: 'FA Cup' },
  { id: 'soccer/eng.league_cup',   group: 'Football',        label: 'Carabao Cup' },
  { id: 'soccer/uefa.champions',   group: 'Football',        label: 'Champions League' },
  { id: 'soccer/uefa.europa',      group: 'Football',        label: 'Europa League' },
  { id: 'soccer/uefa.europa.conf', group: 'Football',        label: 'Conference League' },
  { id: 'soccer/uefa.nations',     group: 'Football',        label: 'Nations League' },
  { id: 'soccer/fifa.world',       group: 'Football',        label: 'FIFA World Cup' },
  { id: 'soccer/fifa.worldq.uefa', group: 'Football',        label: 'World Cup Qualifying (UEFA)' },
  { id: 'soccer/caf.nations',      group: 'Football',        label: 'Africa Cup of Nations' },
  { id: 'soccer/ind.1',            group: 'Football',        label: 'Indian Super League' },
  { id: 'soccer/usa.1',            group: 'Football',        label: 'MLS' },
  { id: 'soccer/mex.1',            group: 'Football',        label: 'Liga MX' },

  { id: 'cricket/8048',            group: 'Cricket',         label: 'IPL' },
  { id: 'cricket/8039',            group: 'Cricket',         label: 'ICC Cricket World Cup' },
  { id: 'cricket/8037',            group: 'Cricket',         label: 'ICC Champions Trophy' },
  { id: 'cricket/8044',            group: 'Cricket',         label: 'Big Bash League' },
  { id: 'cricket/8043',            group: 'Cricket',         label: 'Sheffield Shield' },
  { id: 'cricket/8050',            group: 'Cricket',         label: 'Ranji Trophy' },
  { id: 'cricket/8052',            group: 'Cricket',         label: 'County Championship' },
  { id: 'cricket/8053',            group: 'Cricket',         label: 'T20 Blast (ENG)' },

  { id: 'racing/f1',               group: 'Formula 1',       label: 'Formula 1' },
];

const LEAGUE_BY_ID = new Map(LEAGUES.map(l => [l.id, l]));
const DISCOVERED_LABELS = new Map();            // filled in by discovery
const labelFor = id => (LEAGUE_BY_ID.get(id) || {}).label || DISCOVERED_LABELS.get(id) || id;
const sportOf = leagueId => {
  const s = String(leagueId);
  if (s.startsWith('cricket/')) return 'cricket';
  if (s.startsWith('racing/')) return 'f1';
  return 'football';
};

const FOOTBALL_KINDS = ['start', 'goal', 'red', 'yellow', 'sub', 'break', 'other', 'final'];
const CRICKET_KINDS = ['start', 'wicket', 'batterMilestone', 'teamMilestone', 'bowlerMilestone', 'boundary', 'innings', 'final'];
const F1_KINDS = ['start', 'lead', 'driverPosition', 'final'];
const F1_SESSIONS = ['race', 'sprint', 'qualifying', 'practice'];

// When several moments land in the same poll cycle, the most important one gets
// the notification title; the rest go in a second, quieter one.
const PRIORITY = {
  goal: 100, red: 90, final: 85, wicket: 80, batterMilestone: 70, bowlerMilestone: 65,
  teamMilestone: 60, other: 55, lead: 52, start: 50, innings: 45, sub: 40, break: 35,
  driverPosition: 30, boundary: 20, yellow: 15,
};

const DEFAULT_PREFS = {
  leagues: [],
  teams: {},
  football: { start: true, goal: true, red: true, yellow: false, sub: true, break: true, other: true, final: true },
  cricket: { start: true, wicket: true, batterMilestone: true, teamMilestone: true, bowlerMilestone: true, boundary: false, innings: true, final: true },
  f1: { start: true, lead: true, driverPosition: true, final: true, race: true, sprint: true, qualifying: true, practice: false },
  teamMode: {},                              // league -> 'all' | 'only' | 'except'
  follow: { cricket: [], football: [] },     // team ids followed across every competition
  digestMinutes: 0,
  enabled: true,
};

// v1 stored one flat { start, score, period, final } block.
function migratePrefs(p = {}) {
  const out = {
    ...DEFAULT_PREFS,
    ...p,
    football: { ...DEFAULT_PREFS.football, ...(p.football || {}) },
    cricket: { ...DEFAULT_PREFS.cricket, ...(p.cricket || {}) },
    f1: { ...DEFAULT_PREFS.f1, ...(p.f1 || {}) },
    teamMode: { ...(p.teamMode || {}) },
    follow: {
      cricket: [...((p.follow || {}).cricket || [])].map(String),
      football: [...((p.follow || {}).football || [])].map(String),
    },
  };
  if (p.events && !p.football && !p.cricket) {
    const e = p.events;
    out.football = { ...out.football, start: e.start !== false, goal: e.score !== false, red: e.score !== false, break: e.period !== false, final: e.final !== false };
    out.cricket = { ...out.cricket, start: e.start !== false, wicket: e.score !== false, innings: e.period !== false, final: e.final !== false };
  }
  delete out.events;
  // Drop leagues from the old multi-sport catalogue (NBA, NFL, ...).
  out.leagues = (out.leagues || []).filter(id => /^(soccer|cricket|racing)\//.test(id));
  return out;
}

/* ------------------------------------------------------------ HTTP helper */

async function getJson(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'live-sports-push/1.0', Accept: 'application/json', 'Accept-Encoding': 'gzip' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------------------------------------- scoreboard */

function normalizeEvent(leagueId, ev) {
  const sport = sportOf(leagueId);
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
    state: type.state || 'pre',
    desc: type.description || '',
    detail: type.shortDetail || type.detail || type.description || '',
    clock: st.displayClock && st.displayClock !== "0'" ? st.displayClock : '',
    period: Number(st.period || 0),
    summary: st.summary || '',
    teams,
  };
}

// A Grand Prix weekend is one ESPN event holding several sessions (FP1..Race).
// Each session becomes its own entry, because each starts, runs and finishes.
function sessionKind(abbr = '') {
  const a = String(abbr).toLowerCase();
  if (/^fp|practice/.test(a)) return 'practice';
  if (/^sq|sprint q/.test(a)) return 'sprint';
  if (/sprint|^sr$/.test(a)) return 'sprint';
  if (/^q|qual/.test(a)) return 'qualifying';
  return 'race';
}

const SESSION_LABEL = { practice: 'Practice', qualifying: 'Qualifying', sprint: 'Sprint', race: 'Race' };

function normalizeF1(leagueId, ev) {
  const gp = ev.shortName || ev.name || 'Grand Prix';
  return (ev.competitions || []).map(comp => {
    const st = comp.status || {};
    const type = st.type || {};
    const abbr = (comp.type || {}).abbreviation || '';
    const kind = sessionKind(abbr);
    const drivers = (comp.competitors || []).map(c => ({
      id: String(c.id || (c.athlete || {}).id || ''),
      name: (c.athlete || {}).displayName || (c.athlete || {}).fullName || '?',
      short: (c.athlete || {}).shortName || (c.athlete || {}).displayName || '?',
      order: Number(c.order || 0),
      winner: c.winner === true || c.winner === 'true',
    })).sort((a, b) => a.order - b.order);

    return {
      id: `${ev.id}.${comp.id}`,
      league: leagueId,
      leagueLabel: labelFor(leagueId),
      sport: 'f1',
      session: kind,
      sessionLabel: abbr || SESSION_LABEL[kind],
      name: `${gp} · ${abbr || SESSION_LABEL[kind]}`,
      circuit: (ev.circuit || {}).fullName || '',
      date: comp.startDate || comp.date || ev.date || null,
      state: type.state || 'pre',
      desc: type.description || '',
      detail: type.shortDetail || type.detail || type.description || '',
      clock: '',
      period: Number(st.period || 0),            // lap number during a race
      summary: '',
      teams: [],
      drivers,
    };
  });
}

async function fetchLeague(leagueId) {
  const json = await getJson(`${ESPN}/${leagueId}/scoreboard`);
  const events = (json.events || []).filter(ev => ev && ev.id);
  if (sportOf(leagueId) === 'f1') return events.flatMap(ev => normalizeF1(leagueId, ev));
  return events.map(ev => normalizeEvent(leagueId, ev)).filter(ev => ev.teams.length >= 2);
}

const liveCache = new Map();

async function leagueEvents(leagueId, maxAgeMs = 20000) {
  const hit = liveCache.get(leagueId);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.events;
  const events = await fetchLeague(leagueId);
  liveCache.set(leagueId, { at: Date.now(), events });
  return events;
}

/* -------------------------------------------------------------- wording */

function podium(ev) {
  const top = (ev.drivers || []).filter(d => d.order > 0).slice(0, 3);
  if (!top.length) return ev.circuit || '';
  return top.map((d, i) => `${i + 1}. ${d.short}`).join('  ');
}

function scoreline(ev) {
  if (ev.sport === 'f1') {
    const leader = (ev.drivers || []).find(d => d.order === 1);
    if (ev.state === 'post') return podium(ev);
    if (ev.state === 'in') return `${leader ? 'Leader: ' + leader.short : 'Underway'}${ev.period ? ' · lap ' + ev.period : ''}`;
    return ev.circuit || ev.name;
  }
  const t = ev.teams;
  if (t.length < 2) return ev.name;
  if (ev.sport === 'cricket') return t.map(x => `${x.abbr} ${x.score || '—'}`.trim()).join('  |  ');
  const home = t.find(x => x.home) || t[0];
  const away = t.find(x => !x.home) || t[1];
  return `${home.abbr} ${home.score || 0} – ${away.score || 0} ${away.abbr}`;
}

const BREAK_RE = /half|break|innings|interval|delay|suspend|rain|postpon|extra time|shootout/i;
const isBreak = d => !!d && !/^in progress$/i.test(d) && BREAK_RE.test(d);

function snapshotOf(ev) {
  const snap = {
    state: ev.state,
    desc: ev.desc,
    period: ev.period,
    scores: ev.teams.map(t => t.score),
    wickets: ev.teams.map(t => t.wickets),
  };
  if (ev.sport === 'f1') {
    const lead = (ev.drivers || []).find(d => d.order === 1);
    snap.leader = lead ? lead.id : null;
    snap.positions = Object.fromEntries((ev.drivers || []).map(d => [d.id, d.order]));
  }
  return snap;
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
 * Scoreboard-level alerts. Start and final always come from here (they are
 * reliable and cost nothing). Mid-match alerts are only produced when the
 * match's detail feed is unavailable, so nothing is announced twice.
 */
function diffF1(prev, ev) {
  const out = [];
  const league = ev.leagueLabel;

  if (prev.state === 'pre' && ev.state === 'in') {
    out.push({ kind: 'start', session: ev.session, head: `🏁 ${ev.name} underway`, sub: `${ev.circuit || ''} · ${league}`.replace(/^ · /, '') });
  }

  if (prev.state === 'in' && ev.state === 'in') {
    const lead = (ev.drivers || []).find(d => d.order === 1);
    if (lead && prev.leader && lead.id !== prev.leader) {
      out.push({ kind: 'lead', session: ev.session, head: `🔴 New leader: ${lead.name}`, sub: `${ev.name}${ev.period ? ' · lap ' + ev.period : ''} · ${league}` });
    }
    for (const d of ev.drivers || []) {
      const before = prev.positions ? prev.positions[d.id] : undefined;
      if (before && d.order && d.order !== before) {
        out.push({
          kind: 'driverPosition', session: ev.session, driverId: d.id,
          head: `${d.order < before ? '⬆️' : '⬇️'} ${d.short} P${d.order}`,
          sub: `was P${before}${ev.period ? ' · lap ' + ev.period : ''} · ${ev.name}`,
        });
      }
    }
  }

  if (prev.state !== 'post' && ev.state === 'post') {
    const winner = (ev.drivers || []).find(d => d.winner) || (ev.drivers || []).find(d => d.order === 1);
    const verb = ev.session === 'qualifying' ? 'takes pole'
      : ev.session === 'practice' ? `fastest in ${ev.sessionLabel}`
      : ev.session === 'sprint' ? 'wins the sprint' : 'wins';
    const icon = ev.session === 'practice' ? '⏱️' : '🏆';
    out.push({
      kind: 'final', session: ev.session,
      head: winner ? `${icon} ${winner.name} ${verb}` : `🏁 ${ev.name} finished`,
      sub: `${podium(ev)} · ${ev.name}`,
    });
  }

  return out;
}

function diffEvent(prev, ev, enriched) {
  if (ev.sport === 'f1') return diffF1(prev, ev);
  const out = [];
  const league = ev.leagueLabel;

  if (prev.state === 'pre' && ev.state === 'in') {
    out.push({
      kind: 'start',
      head: `🔴 ${ev.sport === 'cricket' ? 'Play underway' : 'Kick-off'}: ${ev.name}`,
      sub: `${scoreline(ev)} · ${league}`,
    });
  }

  if (!enriched && prev.state === 'in' && ev.state === 'in') {
    if (ev.sport === 'football' && ev.teams.map(t => t.score).join('|') !== prev.scores.join('|')) {
      const scorer = whoScored(prev, ev);
      out.push({ kind: 'goal', head: `⚽ ${scoreline(ev)}`, sub: `${scorer ? 'Goal — ' + scorer : 'Goal'}${ev.clock ? ' ' + ev.clock : ''} · ${league}` });
    }
    if (ev.sport === 'cricket') {
      const gotWicket = ev.teams.some((t, i) => {
        const before = prev.wickets ? prev.wickets[i] : null;
        return t.wickets !== null && before !== null && before !== undefined && t.wickets > before;
      });
      if (gotWicket) out.push({ kind: 'wicket', head: `🏏 Wicket! ${scoreline(ev)}`, sub: `${ev.detail || ''} · ${league}`.trim() });
      else if (ev.period !== prev.period && ev.period > 0) out.push({ kind: 'innings', head: `🏏 Innings ${ev.period}: ${scoreline(ev)}`, sub: league });
    }
    const flagged = out.some(a => a.kind === 'innings' || a.kind === 'break');
    if (!flagged && ev.desc !== prev.desc && isBreak(ev.desc)) {
      out.push({ kind: ev.sport === 'cricket' ? 'innings' : 'break', head: `⏸ ${ev.desc}: ${scoreline(ev)}`, sub: league });
    }
  }

  if (prev.state !== 'post' && ev.state === 'post') {
    out.push({
      kind: 'final',
      head: `🏁 ${scoreline(ev)}`,
      sub: `${ev.summary || ev.detail || 'Finished'} · ${league}`,
    });
  }

  return out;
}

/* ----------------------------------------------------------- team lists */

const teamCache = new Map();

async function f1Drivers() {
  // Scheduled sessions carry no competitors, so fall back to the most recent
  // session of the season that does.
  const collect = events => {
    const seen = new Map();
    for (const ev of events) {
      for (const comp of ev.competitions || []) {
        for (const c of comp.competitors || []) {
          const a = c.athlete || {};
          const id = String(c.id || a.id || '');
          if (id && !seen.has(id)) seen.set(id, { id, abbr: a.shortName || '', name: a.displayName || a.fullName || id, logo: (a.flag || {}).href || '' });
        }
      }
    }
    return [...seen.values()];
  };

  try {
    const now = await getJson(`${ESPN}/racing/f1/scoreboard`);
    let drivers = collect(now.events || []);
    if (!drivers.length) {
      const year = new Date().getFullYear();
      const season = await getJson(`${ESPN}/racing/f1/scoreboard?dates=${year}`);
      const done = (season.events || []).filter(ev => (ev.competitions || []).some(c => (c.competitors || []).length));
      const latest = done[done.length - 1];
      if (latest) {
        // The race entry list is the actual grid; practice sessions add reserve
        // drivers who never start.
        const race = (latest.competitions || []).find(c => sessionKind((c.type || {}).abbreviation) === 'race' && (c.competitors || []).length);
        drivers = collect([{ competitions: race ? [race] : latest.competitions }]);
      }
    }
    return drivers;
  } catch { return []; }
}

async function leagueTeams(leagueId) {
  const hit = teamCache.get(leagueId);
  if (hit && Date.now() - hit.at < 12 * 60 * 60 * 1000) return hit.teams;

  if (sportOf(leagueId) === 'f1') {
    const teams = (await f1Drivers()).sort((a, b) => a.name.localeCompare(b.name));
    teamCache.set(leagueId, { at: Date.now(), teams });
    return teams;
  }

  let teams = [];
  try {
    const json = await getJson(`${ESPN}/${leagueId}/teams`);
    const list = (((json.sports || [])[0] || {}).leagues || [])[0] || {};
    teams = (list.teams || []).map(w => w.team || w)
      .map(t => ({ id: String(t.id), abbr: t.abbreviation || t.shortDisplayName || '', name: t.displayName || t.name, logo: t.logo || '' }));
  } catch { teams = []; }

  if (!teams.length) {
    // Cricket has no /teams endpoint — use whoever is on the current scoreboard.
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

/* ------------------------------------------------------------- service */

function createSportsService({ store, persist, livePollSeconds = 20, idlePollSeconds = 180, maxDetailPerCycle = 10 }) {
  store.sportsSubs = store.sportsSubs || {};
  store.sportsSnap = store.sportsSnap || {};
  store.sportsDetail = store.sportsDetail || {};   // eventId -> { sport, at, state }
  const discovery = createDiscovery({ store, persist });

  let lastLiveCount = 0;
  let detailCursor = 0;                            // round-robin when many matches are live

  const activeSubs = () => Object.entries(store.sportsSubs)
    .filter(([, r]) => r && r.subscription && (r.prefs || {}).enabled !== false)
    .map(([id, r]) => [id, migratePrefs(r.prefs || {}), r]);

  function followedTeamIds(sport) {
    const set = new Set();
    for (const [, prefs] of activeSubs()) ((prefs.follow || {})[sport] || []).forEach(id => set.add(String(id)));
    return [...set];
  }

  async function followedLeagues() {
    const set = new Set();
    for (const [, prefs] of activeSubs()) (prefs.leagues || []).forEach(l => set.add(l));

    // Teams are followed across every competition, so ask discovery which
    // series currently hold one of their matches.
    for (const [sport, espnSport] of [['cricket', 'cricket'], ['football', 'soccer']]) {
      const ids = followedTeamIds(sport);
      if (!ids.length) continue;
      try {
        for (const comp of await discovery.competitions(espnSport)) DISCOVERED_LABELS.set(comp.id, comp.label);
        (await discovery.leaguesForTeams(espnSport, ids)).forEach(l => set.add(l));
      } catch (e) {
        console.error('[sports] discovery failed', sport, e.message);
      }
    }
    return [...set];
  }

  function follows(prefs, ev) {
    const byTeam = (prefs.follow || {})[ev.sport] || [];
    if (byTeam.length && (ev.teams || []).some(t => byTeam.includes(String(t.id)))) return true;
    if (!(prefs.leagues || []).includes(ev.league)) return false;
    if (ev.sport === 'f1') return true;            // a session involves every driver
    const picked = (prefs.teams || {})[ev.league] || [];
    const mode = (prefs.teamMode || {})[ev.league] || (picked.length ? 'only' : 'all');
    if (mode === 'all' || !picked.length) return true;
    const hit = ev.teams.some(t => picked.includes(t.id));
    return mode === 'except' ? !hit : hit;
  }

  const anyoneFollows = ev => activeSubs().some(([, prefs]) => follows(prefs, ev));

  /** Does this subscriber want this particular alert? */
  function wants(prefs, ev, alert) {
    const block = prefs[ev.sport] || {};
    if (block[alert.kind] === false) return false;
    if (ev.sport === 'f1') {
      if (alert.session && block[alert.session] === false) return false;
      if (alert.kind === 'driverPosition') {
        const picked = (prefs.teams || {})['racing/f1'] || [];
        const mode = (prefs.teamMode || {})['racing/f1'] || (picked.length ? 'only' : 'all');
        if (!picked.length) return false;          // every driver moving would be spam
        return mode === 'except' ? !picked.includes(alert.driverId) : picked.includes(alert.driverId);
      }
    }
    return true;
  }

  async function send(userId, payload) {
    const rec = store.sportsSubs[userId];
    if (!rec || !rec.subscription) return false;
    try {
      await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('[sports] push failed', e.statusCode || e.message, userId);
      if (e.statusCode === 404 || e.statusCode === 410) { delete store.sportsSubs[userId]; persist(); }
      return false;
    }
  }

  /** Fetch a live match's detail feed and turn it into alerts. */
  async function enrich(ev) {
    if (ev.sport === 'f1') return null;            // no detail feed; scoreboard is the source
    const key = ev.id;
    const saved = store.sportsDetail[key];
    const prevState = saved && saved.state;
    try {
      if (ev.sport === 'football') {
        const keyEvents = await detail.footballKeyEvents(ev.league, ev.id);
        const r = detail.diffFootball(ev, prevState, scoreline(ev), keyEvents);
        store.sportsDetail[key] = {
          sport: 'football', at: Date.now(), state: r.state,
          finalAnnounced: (saved && saved.finalAnnounced) || r.alerts.some(a => a.kind === 'final'),
        };
        return r.alerts;
      }
      const { items, pageCount } = await detail.cricketBalls(ev.league, ev.id, prevState && prevState.page);
      const r = detail.diffCricket(ev, prevState, items, pageCount);
      store.sportsDetail[key] = { sport: 'cricket', at: Date.now(), state: r.state };
      return r.alerts;
    } catch (e) {
      console.error('[sports] detail failed', ev.league, ev.id, e.message);
      return null;                                 // null = fall back to scoreboard diffing
    }
  }

  let running = false;

  async function poll() {
    if (running) return { live: lastLiveCount };
    running = true;
    try {
      const leagues = await followedLeagues();
      if (!leagues.length) { lastLiveCount = 0; return { live: 0 }; }

      const byLeague = {};
      for (const leagueId of leagues) {
        try {
          const events = await fetchLeague(leagueId);
          liveCache.set(leagueId, { at: Date.now(), events });
          byLeague[leagueId] = events;
        } catch (e) {
          console.error('[sports] scoreboard failed', leagueId, e.message);
        }
      }

      // Which live matches does anybody actually follow?
      const liveFollowed = [];
      for (const events of Object.values(byLeague)) {
        for (const ev of events) if (ev.state === 'in' && anyoneFollows(ev)) liveFollowed.push(ev);
      }
      lastLiveCount = liveFollowed.length;

      // Detail feeds, capped per cycle and rotated so nothing starves.
      const enrichedAlerts = new Map();            // eventId -> alerts[]
      if (liveFollowed.length) {
        const order = [];
        for (let i = 0; i < liveFollowed.length; i++) order.push(liveFollowed[(detailCursor + i) % liveFollowed.length]);
        detailCursor = (detailCursor + Math.min(maxDetailPerCycle, liveFollowed.length)) % Math.max(1, liveFollowed.length);
        for (const ev of order.slice(0, maxDetailPerCycle)) {
          const alerts = await enrich(ev);
          if (alerts !== null) enrichedAlerts.set(ev.id, alerts);
        }
      }

      // Scoreboard-level diffing (start / final always, mid-match as fallback).
      const perEvent = [];                         // { ev, alerts }
      for (const [leagueId, events] of Object.entries(byLeague)) {
        const seeded = !!store.sportsSnap[leagueId];
        const prevSnaps = store.sportsSnap[leagueId] || {};
        const nextSnaps = {};
        for (const ev of events) {
          const prev = prevSnaps[ev.id];
          nextSnaps[ev.id] = snapshotOf(ev);
          const fromDetail = enrichedAlerts.get(ev.id) || [];
          let fromBoard = seeded && prev ? diffEvent(prev, ev, enrichedAlerts.has(ev.id)) : [];
          if ((store.sportsDetail[ev.id] || {}).finalAnnounced) {
            fromBoard = fromBoard.filter(a => a.kind !== 'final');
          }
          const alerts = [...fromBoard, ...fromDetail];
          if (alerts.length) perEvent.push({ ev, alerts });
        }
        store.sportsSnap[leagueId] = nextSnaps;
      }

      // Fan out.
      for (const [userId, prefs, rec] of activeSubs()) {
        const mine = [];
        for (const { ev, alerts } of perEvent) {
          if (!follows(prefs, ev)) continue;
          const keep = alerts.filter(a => wants(prefs, ev, a));
          if (keep.length) mine.push({ ev, alerts: keep });
        }

        for (const { ev, alerts } of mine.slice(0, 6)) {
          const ranked = [...alerts].sort((x, y) => (PRIORITY[y.kind] || 0) - (PRIORITY[x.kind] || 0));
          const top = ranked[0];
          await send(userId, {
            kind: 'sports', title: top.head, body: top.sub,
            tag: 'match:' + ev.id, url: '/sports.html',
          });
          const rest = ranked.slice(1);
          if (rest.length) {
            await send(userId, {
              kind: 'sports',
              title: rest.length === 1 ? rest[0].head : `${rest.length} more · ${ev.name}`,
              body: rest.length === 1 ? rest[0].sub : rest.map(r => r.head).join('\n'),
              tag: 'match:' + ev.id + ':more',
              url: '/sports.html',
            });
          }
        }
        if (mine.length > 6) {
          await send(userId, {
            kind: 'sports',
            title: `+${mine.length - 6} more updates`,
            body: mine.slice(6).map(m => m.alerts[m.alerts.length - 1].head).join('\n'),
            tag: 'sports:overflow',
            url: '/sports.html',
          });
        }

        const every = Number(prefs.digestMinutes || 0);
        if (every > 0 && (!rec.lastDigest || Date.now() - rec.lastDigest >= every * 60 * 1000)) {
          const live = liveFollowed.filter(ev => follows(prefs, ev));
          if (live.length) {
            const ok = await send(userId, {
              kind: 'sports',
              title: live.length === 1 ? scoreline(live[0]) : `${live.length} matches live`,
              body: live.length === 1
                ? `${live[0].detail} · ${live[0].leagueLabel}`
                : live.slice(0, 5).map(ev => `${scoreline(ev)}${ev.clock ? ' (' + ev.clock + ')' : ''}`).join('\n'),
              tag: 'sports:digest',
              url: '/sports.html',
            });
            if (ok) rec.lastDigest = Date.now();
          }
        }
      }

      // Housekeeping: forget unfollowed leagues and finished matches.
      for (const leagueId of Object.keys(store.sportsSnap)) {
        if (!leagues.includes(leagueId)) delete store.sportsSnap[leagueId];
      }
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [id, d] of Object.entries(store.sportsDetail)) {
        if (!d || !d.at || d.at < cutoff) delete store.sportsDetail[id];
      }
      persist();
      return { live: lastLiveCount };
    } catch (e) {
      console.error('[sports] poll error', e.message);
      return { live: lastLiveCount };
    } finally {
      running = false;
    }
  }

  let timer = null;
  function loop() {
    const wait = (lastLiveCount > 0 ? livePollSeconds : idlePollSeconds) * 1000;
    timer = setTimeout(async () => { await poll(); loop(); }, wait);
    if (timer.unref) timer.unref();
  }

  function start() {
    setTimeout(async () => { await poll(); loop(); }, 4000);
    console.log(`[sports] polling every ${livePollSeconds}s while live, ${idlePollSeconds}s otherwise`);
  }

  /* ---------------------------------------------------------- routes */

  function register(app) {
    app.get('/sports/leagues', (_req, res) => res.json({
      leagues: LEAGUES,
      kinds: { football: FOOTBALL_KINDS, cricket: CRICKET_KINDS, f1: F1_KINDS },
      f1Sessions: F1_SESSIONS,
    }));

    app.get('/sports/teams', async (req, res) => {
      const league = String(req.query.league || '');
      if (!league) return res.status(400).json({ error: 'missing league' });
      try { res.json({ league, teams: await leagueTeams(league) }); }
      catch (e) { res.status(502).json({ error: e.message }); }
    });

    app.get('/sports/live', async (req, res) => {
      const ids = String(req.query.leagues || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
      if (!ids.length) return res.json({ events: [] });
      const out = [];
      await Promise.all(ids.map(async id => { try { out.push(...(await leagueEvents(id))); } catch { /* skip */ } }));
      const rank = { in: 0, pre: 1, post: 2 };
      out.sort((a, b) => (rank[a.state] - rank[b.state]) || String(a.date).localeCompare(String(b.date)));
      res.json({
        events: out.map(ev => ({ ...ev, line: scoreline(ev) })),
        at: new Date().toISOString(),
        livePolling: lastLiveCount > 0,
      });
    });

    app.get('/sports/validate', async (req, res) => {
      const league = String(req.query.league || '').replace(/^\/+|\/+$/g, '');
      if (!/^(soccer|cricket|racing)\/[a-z0-9._-]+$/i.test(league)) {
        return res.status(400).json({ ok: false, error: 'expected soccer/<slug>, cricket/<id> or racing/<series>' });
      }
      try {
        const json = await getJson(`${ESPN}/${league}/scoreboard`);
        const name = ((json.leagues || [])[0] || {}).name;
        if (!name) return res.status(404).json({ ok: false, error: 'no such league' });
        const group = sportOf(league) === 'cricket' ? 'Cricket' : sportOf(league) === 'f1' ? 'Formula 1' : 'Football';
        res.json({ ok: true, league, label: name, group });
      } catch (e) { res.status(404).json({ ok: false, error: e.message }); }
    });

    app.post('/sports/subscribe', (req, res) => {
      const { userId, subscription, prefs } = req.body || {};
      if (!userId || !subscription) return res.status(400).json({ error: 'missing fields' });
      const existing = store.sportsSubs[userId] || {};
      store.sportsSubs[userId] = {
        ...existing,
        subscription,
        prefs: migratePrefs({ ...(existing.prefs || {}), ...(prefs || {}) }),
      };
      persist();
      res.json({ ok: true, prefs: store.sportsSubs[userId].prefs });
    });

    app.post('/sports/prefs', (req, res) => {
      const { userId, prefs } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'missing userId' });
      const rec = store.sportsSubs[userId];
      if (!rec) return res.status(404).json({ error: 'not subscribed' });
      const merged = { ...(rec.prefs || {}), ...(prefs || {}) };
      if (prefs && prefs.football) merged.football = { ...((rec.prefs || {}).football || {}), ...prefs.football };
      if (prefs && prefs.cricket) merged.cricket = { ...((rec.prefs || {}).cricket || {}), ...prefs.cricket };
      rec.prefs = migratePrefs(merged);
      persist();
      res.json({ ok: true, prefs: rec.prefs });
    });

    app.get('/sports/prefs', (req, res) => {
      const rec = store.sportsSubs[String(req.query.userId || '')];
      res.json({ subscribed: !!rec, prefs: rec ? migratePrefs(rec.prefs || {}) : DEFAULT_PREFS });
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
        title: '✅ Live updates are on',
        body: 'Goals, red cards, subs, wickets and milestones will arrive like this — with the page closed.',
        tag: 'sports:test',
        url: '/sports.html',
      });
      res.json({ ok });
    });

    // Search the team directory (built from every competition seen recently).
    app.get('/sports/search-teams', async (req, res) => {
      const sport = String(req.query.sport || 'cricket') === 'football' ? 'football' : 'cricket';
      const espnSport = sport === 'cricket' ? 'cricket' : 'soccer';
      try { await discovery.competitions(espnSport); } catch { /* use what we have */ }
      res.json({ sport, teams: discovery.directory(sport, req.query.q || '', Number(req.query.limit) || 60) });
    });

    // Every competition with matches in the next couple of weeks — tours and
    // one-off series included.
    app.get('/sports/series', async (req, res) => {
      const sport = String(req.query.sport || 'cricket') === 'football' ? 'football' : 'cricket';
      const espnSport = sport === 'cricket' ? 'cricket' : 'soccer';
      try {
        const comps = await discovery.competitions(espnSport);
        comps.forEach(c => DISCOVERED_LABELS.set(c.id, c.label));
        res.json({
          sport,
          series: comps
            .map(c => ({
              id: c.id, label: c.label, matches: c.events.length,
              live: c.events.filter(e => e.state === 'in').length,
              teams: [...new Set(c.events.flatMap(e => e.teams.map(t => t.abbr)))].slice(0, 6),
            }))
            .sort((a, b) => b.live - a.live || b.matches - a.matches),
        });
      } catch (e) { res.status(502).json({ error: e.message }); }
    });

    // Everything one subscriber follows, by league or by team.
    app.get('/sports/my-board', async (req, res) => {
      const userId = String(req.query.userId || '');
      const rec = store.sportsSubs[userId];
      const prefs = migratePrefs(rec ? rec.prefs || {} : (() => {
        try { return JSON.parse(String(req.query.prefs || '{}')); } catch { return {}; }
      })());

      const ids = new Set(prefs.leagues || []);
      for (const [sport, espnSport] of [['cricket', 'cricket'], ['football', 'soccer']]) {
        const teams = (prefs.follow || {})[sport] || [];
        if (!teams.length) continue;
        try {
          for (const comp of await discovery.competitions(espnSport)) DISCOVERED_LABELS.set(comp.id, comp.label);
          (await discovery.leaguesForTeams(espnSport, teams)).forEach(l => ids.add(l));
        } catch { /* skip */ }
      }

      const out = [];
      await Promise.all([...ids].slice(0, 20).map(async id => {
        try { out.push(...(await leagueEvents(id))); } catch { /* skip */ }
      }));

      const mine = out.filter(ev => follows(prefs, ev));
      const rank = { in: 0, pre: 1, post: 2 };
      mine.sort((a, b) => (rank[a.state] - rank[b.state]) || String(a.date).localeCompare(String(b.date)));
      res.json({
        events: mine.slice(0, 40).map(ev => ({ ...ev, line: scoreline(ev) })),
        at: new Date().toISOString(),
      });
    });

    app.post('/sports/poll-now', async (_req, res) => res.json({ ok: true, ...(await poll()) }));
  }

  return { register, start, poll, leagueEvents, leagueTeams, status: () => ({ live: lastLiveCount }) };
}

module.exports = {
  createSportsService, LEAGUES, DISCOVERED_LABELS, FOOTBALL_KINDS, CRICKET_KINDS, F1_KINDS, F1_SESSIONS,
  normalizeF1, diffF1, podium,
  normalizeEvent, diffEvent, snapshotOf, scoreline, migratePrefs, DEFAULT_PREFS,
};
