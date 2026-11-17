'use strict';
/**
 * Competition discovery.
 *
 * The fixed league list can never cover cricket: bilateral tours ("India tour
 * of New Zealand 2026/27"), A-team series, domestic and women's competitions
 * each get their own ESPN id as they are created. ESPN's scoreboard *header*
 * feed lists every competition with matches in a given window, so this module
 * reads that instead of hardcoding ids — which is also what makes "follow a
 * team and get all of its matches, whatever the series" possible.
 *
 * It also builds a team directory as a side effect: every side seen in the
 * window is remembered, so the picker fills out over time.
 */

const HEADER = 'https://site.web.api.espn.com/apis/v2/scoreboard/header';

// Today plus a fortnight ahead — enough to catch a tour before it starts.
const DAY_OFFSETS = [0, 2, 5, 9, 14];

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

const yyyymmdd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

function parseHeader(json, sport) {
  const out = [];
  for (const s of json.sports || []) {
    for (const lg of s.leagues || []) {
      const leagueId = `${sport === 'cricket' ? 'cricket' : 'soccer'}/${lg.id}`;
      const events = (lg.events || []).map(ev => ({
        id: String(ev.id),
        league: leagueId,
        leagueLabel: lg.name || lg.shortName || leagueId,
        sport: sport === 'cricket' ? 'cricket' : 'football',
        name: ev.shortName || ev.name || '',
        title: ev.title || '',
        date: ev.date || null,
        state: ev.status || ((ev.fullStatus || {}).type || {}).state || 'pre',
        summary: ev.summary || '',
        teams: (ev.competitors || []).map(c => ({
          id: String(c.id || ''),
          abbr: c.abbreviation || c.name || '',
          name: c.displayName || c.abbreviation || '',
          logo: c.logo || '',
          national: c.isNational === true,
        })).filter(t => t.id),
      })).filter(ev => ev.teams.length >= 2);
      if (events.length) out.push({ id: leagueId, label: lg.name || leagueId, events });
    }
  }
  return out;
}

function createDiscovery({ store, persist, ttlMinutes = 15 }) {
  store.sportsDirectory = store.sportsDirectory || { cricket: {}, football: {} };
  const cache = new Map();   // sport -> { at, competitions }

  function remember(sport, teams) {
    const dir = store.sportsDirectory[sport] || (store.sportsDirectory[sport] = {});
    for (const t of teams) {
      const prev = dir[t.id] || {};
      dir[t.id] = {
        name: t.name || prev.name,
        abbr: t.abbr || prev.abbr,
        logo: t.logo || prev.logo,
        national: t.national || prev.national || false,
        seen: Date.now(),
      };
    }
  }

  /** Every competition with matches in the next couple of weeks. */
  async function competitions(sport, maxAgeMs = ttlMinutes * 60 * 1000) {
    const hit = cache.get(sport);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.competitions;

    const merged = new Map();
    const now = new Date();
    for (const offset of DAY_OFFSETS) {
      const d = new Date(now.getTime() + offset * 86400000);
      const url = `${HEADER}?sport=${sport}${offset ? '&dates=' + yyyymmdd(d) : ''}`;
      let json;
      try { json = await getJson(url); } catch (e) { continue; }
      for (const comp of parseHeader(json, sport)) {
        const existing = merged.get(comp.id);
        if (!existing) { merged.set(comp.id, comp); continue; }
        const seen = new Set(existing.events.map(e => e.id));
        existing.events.push(...comp.events.filter(e => !seen.has(e.id)));
      }
    }

    const competitionsList = [...merged.values()];
    competitionsList.forEach(c => c.events.forEach(e => remember(sport === 'cricket' ? 'cricket' : 'football', e.teams)));
    if (competitionsList.length) {
      cache.set(sport, { at: Date.now(), competitions: competitionsList });
      persist();
    }
    return competitionsList;
  }

  /** Flat list of upcoming/live matches across every discovered competition. */
  async function fixtures(sport) {
    const comps = await competitions(sport);
    return comps.flatMap(c => c.events);
  }

  /** Leagues holding a match for any of these team ids. */
  async function leaguesForTeams(sport, teamIds) {
    if (!teamIds || !teamIds.length) return [];
    const want = new Set(teamIds.map(String));
    const hits = new Set();
    for (const ev of await fixtures(sport)) {
      if (ev.teams.some(t => want.has(t.id))) hits.add(ev.league);
    }
    return [...hits];
  }

  function directory(sport, q = '', limit = 60) {
    const dir = store.sportsDirectory[sport] || {};
    const needle = String(q).trim().toLowerCase();
    let rows = Object.entries(dir).map(([id, t]) => ({ id, ...t }));
    if (needle) {
      rows = rows.filter(t => (t.name || '').toLowerCase().includes(needle) || (t.abbr || '').toLowerCase().includes(needle));
    }
    // National sides first, then most recently seen.
    rows.sort((a, b) => (b.national - a.national) || (b.seen || 0) - (a.seen || 0) || String(a.name).localeCompare(String(b.name)));
    return rows.slice(0, limit);
  }

  return { competitions, fixtures, leaguesForTeams, directory, remember };
}

module.exports = { createDiscovery, parseHeader };
