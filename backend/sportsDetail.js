'use strict';
/**
 * Detail feeds — the per-match sources that carry the moments a scoreboard
 * summary cannot show.
 *
 *   Football: /summary?event=<id> -> keyEvents (kick-off, goals with scorer,
 *             yellow/red cards, substitutions, half-time, full-time, penalties)
 *   Cricket:  /playbyplay?event=<id>&page=<last> -> ball-by-ball, which carries
 *             wickets, every batter's running total (for 50/100/150/200),
 *             bowler wickets and the team score after each ball
 *
 * Both are diffed against a small persisted cursor, so a restart or a mid-match
 * subscribe never replays old events as fresh notifications.
 */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

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

/* ========================================================== FOOTBALL ===== */

// ESPN keyEvent type.text -> our alert kind. Unlisted types are ignored.
function classifyFootball(text = '') {
  const t = text.toLowerCase();
  if (/delay/.test(t)) return null;                      // VAR check noise
  if (/kickoff|start 1st half|first half begins/.test(t)) return null;  // scoreboard owns kick-off
  if (/own goal/.test(t)) return 'goal';
  if (/penalty\s*-\s*(missed|saved)/.test(t)) return 'other';
  if (/goal|penalty\s*-\s*scored/.test(t)) return 'goal';
  if (/second yellow|yellow red|red card/.test(t)) return 'red';
  if (/yellow card/.test(t)) return 'yellow';
  if (/substitut/.test(t)) return 'sub';
  // The final whistle reaches this feed before the scoreboard flips to "post".
  if (/end regular time|match ends|full-?time|end of (extra time|match)/.test(t)) return 'final';
  if (/halftime|half-time|start 2nd half|second half begins|extra time|shootout/.test(t)) return 'break';
  if (/penalty/.test(t)) return 'other';
  return null;
}

/**
 * ESPN writes the running score into the goal commentary:
 * "Goal! Crystal Palace 0, Liverpool 1. Alexis Mac Allister (Liverpool) header..."
 * Use that rather than the scoreboard, which can lag a goal by a poll cycle.
 */
function scoreFromGoalText(ev, text) {
  const m = /goal!\s*(.+?)\s+(\d+),\s*(.+?)\s+(\d+)\./i.exec(text || '');
  if (!m) return null;
  const [, n1, s1, n2, s2] = m;
  const abbr = name => {
    const hit = ev.teams.find(t => t.name.toLowerCase() === name.trim().toLowerCase())
             || ev.teams.find(t => name.trim().toLowerCase().includes(t.name.toLowerCase()))
             || ev.teams.find(t => t.name.toLowerCase().includes(name.trim().toLowerCase()));
    return hit ? hit.abbr : name.trim();
  };
  return `${abbr(n1)} ${s1}-${s2} ${abbr(n2)}`;
}

// "Assisted by Bradley Barcola with a cross." -> "Bradley Barcola"
const assistFrom = text => {
  const raw = (/assisted by ([^.,]+)/i.exec(text || '') || [])[1];
  return raw ? raw.split(/\s+(?:with|following|after)\s+/i)[0].trim() : undefined;
};

const EMOJI = { start: '🔴', goal: '⚽', red: '🟥', yellow: '🟨', sub: '🔄', break: '⏸', other: '⚠️' };

async function footballKeyEvents(leagueId, eventId) {
  const json = await getJson(`${ESPN}/${leagueId}/summary?event=${encodeURIComponent(eventId)}`);
  return (json.keyEvents || []).map(k => ({
    id: String(k.id),
    typeText: (k.type || {}).text || '',
    text: k.text || '',
    shortText: k.shortText || '',
    clock: ((k.clock || {}).displayValue || '').trim(),
    teamId: String((k.team || {}).id || ''),
    teamName: (k.team || {}).displayName || '',
    players: (k.participants || []).map(p => (p.athlete || {}).displayName).filter(Boolean),
  }));
}

/**
 * @param ev    normalised scoreboard event (for the score line)
 * @param state persisted cursor: { seen: [keyEvent ids] }
 * @returns { alerts, state, seeded }
 */
function diffFootball(ev, state, scoreline, keyEvents) {
  const seen = new Set(state && state.seen ? state.seen : []);
  const fresh = keyEvents.filter(k => !seen.has(k.id));
  const nextState = { seen: keyEvents.map(k => k.id).slice(-120) };

  // First look at this match: record what already happened, announce nothing.
  if (!state || !state.seen) return { alerts: [], state: nextState, seeded: true };

  const alerts = [];
  for (const k of fresh) {
    const kind = classifyFootball(k.typeText);
    if (!kind) continue;
    const when = k.clock ? ' ' + k.clock : '';
    const league = ev.leagueLabel;

    if (kind === 'goal') {
      const own = /own goal/i.test(k.typeText);
      const pen = /penalty/i.test(k.typeText);
      const who = k.players[0] || '';
      const tag = own ? 'Own goal' : pen ? 'Penalty' : 'Goal';
      const assist = assistFrom(k.text);
      alerts.push({
        kind: 'goal',
        head: `⚽ ${tag}! ${scoreFromGoalText(ev, k.text) || scoreline}`,
        sub: `${who ? who + ' ' : ''}${when.trim()}${assist ? ' (assist: ' + assist.trim() + ')' : ''}${k.teamName ? ' · ' + k.teamName : ''} · ${league}`.trim(),
      });
    } else if (kind === 'final') {
      const word = /end regular time|full-?time|match ends/i.test(k.typeText) ? 'Full time' : k.typeText;
      alerts.push({ kind: 'final', head: `🏁 ${word}: ${scoreline}`, sub: `${ev.name} · ${league}` });
    } else if (kind === 'red') {
      alerts.push({
        kind: 'red',
        head: `🟥 Red card: ${k.players[0] || k.teamName || 'player'}`,
        sub: `${k.teamName}${when} · ${scoreline} · ${league}`,
      });
    } else if (kind === 'yellow') {
      alerts.push({
        kind: 'yellow',
        head: `🟨 ${k.players[0] || 'Booking'} booked`,
        sub: `${k.teamName}${when} · ${scoreline} · ${league}`,
      });
    } else if (kind === 'sub') {
      const [on, off] = k.players;
      alerts.push({
        kind: 'sub',
        head: `🔄 ${k.teamName || 'Substitution'}${when}`,
        sub: on && off ? `${on} replaces ${off} · ${league}` : (k.text || k.shortText || league),
      });
    } else if (kind === 'start') {
      alerts.push({ kind: 'start', head: `🔴 Kick-off: ${ev.name}`, sub: `${scoreline} · ${league}` });
    } else if (kind === 'break') {
      alerts.push({ kind: 'break', head: `⏸ ${k.typeText}: ${scoreline}`, sub: league });
    } else {
      alerts.push({
        kind: 'other',
        head: `${EMOJI.other} ${k.typeText}${when}`,
        sub: `${(k.text || k.shortText || '').slice(0, 120) || scoreline} · ${league}`,
      });
    }
  }
  return { alerts, state: nextState, seeded: false };
}

/* =========================================================== CRICKET ===== */

const BATTER_MARKS = [50, 100, 150, 200, 250, 300];
const TEAM_MARKS = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const BOWLER_MARKS = [3, 5, 7, 10];

const crossed = (marks, before, after) => marks.filter(m => before < m && after >= m).pop();

/**
 * A ball carries homeScore and awayScore, but they do NOT follow the
 * scoreboard's home/away: in a live Pakistan home Test, Pakistan's "121/3" sits
 * in awayScore while homeScore reads "0". So pick the side that actually holds
 * an innings in progress ("121/3") rather than trusting the field name.
 */
function battingScore(ball) {
  const a = String(ball.homeScore == null ? '' : ball.homeScore).trim();
  const b = String(ball.awayScore == null ? '' : ball.awayScore).trim();
  const inProgress = v => /\d+\s*\/\s*\d+/.test(v);
  const hasRuns = v => /[1-9]/.test(v);
  if (inProgress(a) !== inProgress(b)) return inProgress(a) ? a : b;
  if (hasRuns(a) !== hasRuns(b)) return hasRuns(a) ? a : b;
  return a.length >= b.length ? a : b;
}
const parseRuns = s => {
  const m = String(s || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

async function cricketBalls(leagueId, eventId, pageHint) {
  const url = p => `${ESPN}/${leagueId}/playbyplay?event=${encodeURIComponent(eventId)}&page=${p}`;
  const fresh = !pageHint;                      // first contact with this match
  const page = Math.max(1, Number(pageHint) || 1);

  let json = await getJson(url(page));
  let c = json.commentary || {};
  const pageCount = Number(c.pageCount || 1);
  let items = c.items || [];

  if (pageCount > page) {
    if (fresh) {
      // Seeding: only the newest page matters. Taking page 1 as the baseline
      // would make the whole innings look unseen on the next poll.
      try {
        const last = await getJson(url(pageCount));
        items = (last.commentary || {}).items || items;
      } catch { /* keep page 1 */ }
    } else {
      // Balls land on the last page; pick up any boundary we rolled past.
      for (let p = page + 1; p <= Math.min(pageCount, page + 2); p++) {
        try {
          const more = await getJson(url(p));
          items = items.concat((more.commentary || {}).items || []);
        } catch { /* keep what we have */ }
      }
    }
  }
  return { items, pageCount };
}

/**
 * @param state persisted cursor:
 *   { lastSeq, page, batters: {athleteId:period -> runs}, teams: {teamId:period -> runs}, bowlers: {...} }
 */
function diffCricket(ev, state, balls, pageCount) {
  const st = {
    lastSeq: state ? state.lastSeq : null,
    page: pageCount || (state && state.page) || 1,
    batters: { ...((state && state.batters) || {}) },
    teams: { ...((state && state.teams) || {}) },
    bowlers: { ...((state && state.bowlers) || {}) },
    period: state ? state.period : null,
  };
  const seeding = !state || state.lastSeq === null || state.lastSeq === undefined;

  const sorted = [...balls].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const fresh = seeding ? sorted : sorted.filter(b => Number(b.sequence || 0) > Number(st.lastSeq));
  if (sorted.length) st.lastSeq = Number(sorted[sorted.length - 1].sequence || 0);

  const league = ev.leagueLabel;
  const alerts = [];

  for (const b of fresh) {
    const period = Number(b.period || 1);
    const battingId = String((b.team || {}).id || '');
    const battingAbbr = (b.team || {}).abbreviation || (b.team || {}).displayName || '';
    const teamScore = battingScore(b);
    const line = `${battingAbbr} ${teamScore || ''}`.trim();
    const play = ((b.playType || {}).description || '').toLowerCase();
    const bat = b.batsman || {};
    const batName = (bat.athlete || {}).displayName || '';
    const bowl = b.bowler || {};
    const bowlName = (bowl.athlete || {}).displayName || '';

    // Innings change
    if (b.periodText && st.period && b.periodText !== st.period && !seeding) {
      alerts.push({ kind: 'innings', head: `🏏 ${b.periodText}: ${line}`, sub: `${ev.name} · ${league}` });
    }
    if (b.periodText) st.period = b.periodText;

    // Wicket
    if (!seeding && /^out$|wicket/.test(play)) {
      alerts.push({
        kind: 'wicket',
        head: `🏏 WICKET: ${batName || 'batter'} ${bat.totalRuns ?? ''}${bat.faced ? ' (' + bat.faced + ')' : ''}`.trim(),
        sub: `${line}${bowlName ? ' · ' + bowlName : ''} · ${league}`,
      });
    }

    // Batter milestones (50 / 100 / 150 / 200 ...)
    if (bat.athlete && bat.athlete.id && bat.totalRuns !== undefined && bat.totalRuns !== null) {
      const key = bat.athlete.id + ':' + period;
      const before = st.batters[key];
      const after = Number(bat.totalRuns);
      const mark = before === undefined ? null : crossed(BATTER_MARKS, Number(before), after);
      st.batters[key] = after;
      if (!seeding && mark) {
        const emoji = mark >= 200 ? '🔥' : mark >= 100 ? '💯' : '🏏';
        const word = mark === 50 ? 'FIFTY' : mark === 100 ? 'HUNDRED' : `${mark}`;
        alerts.push({
          kind: 'batterMilestone',
          head: `${emoji} ${word}: ${batName}`,
          sub: `${after} off ${bat.faced || '?'}${bat.fours || bat.sixes ? ` (${bat.fours || 0}x4, ${bat.sixes || 0}x6)` : ''} · ${line} · ${league}`,
        });
      }
    }

    // Team total milestones, tracked per innings
    const runs = parseRuns(teamScore);
    if (battingId && runs !== null) {
      const key = battingId + ':' + period;
      const before = st.teams[key];
      const mark = before === undefined ? null : crossed(TEAM_MARKS, Number(before), runs);
      st.teams[key] = runs;
      if (!seeding && mark) {
        alerts.push({ kind: 'teamMilestone', head: `🏏 ${battingAbbr} past ${mark}`, sub: `${line} · ${ev.name} · ${league}` });
      }
    }

    // Bowler hauls
    if (bowl.athlete && bowl.athlete.id && bowl.wickets !== undefined) {
      const key = bowl.athlete.id + ':' + period;
      const before = st.bowlers[key];
      const after = Number(bowl.wickets);
      const mark = before === undefined ? null : crossed(BOWLER_MARKS, Number(before), after);
      st.bowlers[key] = after;
      if (!seeding && mark) {
        alerts.push({
          kind: 'bowlerMilestone',
          head: `🎯 ${bowlName}: ${mark} wickets`,
          sub: `${after}/${bowl.conceded ?? '?'} in ${bowl.overs ?? '?'} ov · ${line} · ${league}`,
        });
      }
    }

    // Boundaries (off by default — a T20 would buzz 30 times)
    if (!seeding && (play === 'six' || play === 'four')) {
      alerts.push({
        kind: 'boundary',
        head: `${play === 'six' ? '💥 SIX' : '4️⃣ FOUR'}: ${batName}`,
        sub: `${b.shortText || ''} · ${line} · ${league}`,
      });
    }
  }

  // Keep the cursor small.
  const trim = obj => Object.fromEntries(Object.entries(obj).slice(-60));
  st.batters = trim(st.batters);
  st.teams = trim(st.teams);
  st.bowlers = trim(st.bowlers);

  return { alerts, state: st, seeded: seeding };
}

module.exports = {
  footballKeyEvents, diffFootball, classifyFootball, scoreFromGoalText, battingScore,
  cricketBalls, diffCricket,
};
