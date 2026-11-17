# reminder-server

A tiny Node server that sends **Web Push** notifications, so updates arrive on your phone
even when the page is closed or swiped away. Nothing is installed from an app store.

It now does two things:

| Path | What it is |
|---|---|
| `/sports.html` | **Live Scores** — real-time cricket & football updates as notifications |
| `/` | Penalty Kings (the game) |
| `/health` | status check |

## Live cricket & football updates

Open `https://<your-app>.onrender.com/sports.html`, pick the leagues (and optionally the
exact teams) you care about, choose which moments should buzz, and tap **Turn on live
updates**. You can then close the page.

**On iPhone/iPad you must add the page to your Home Screen first** (Share → Add to Home
Screen), then open it from that icon and turn updates on. iOS only allows web push for
home-screen pages. It's a shortcut of a few KB, not an app download. Requires iOS 16.4+.
On Android/desktop Chrome, Edge or Firefox it works straight from the browser tab.

Notifications arrive with the page closed, swiped away or force-quit — the browser's push
service wakes the service worker, not the page.

### What gets pushed

**Football**

| Moment | Example notification |
|---|---|
| Goal | `⚽ Goal! CRY 0 – 2 LIV` · *Florian Wirtz 54' (assist: Bradley Barcola)* |
| Penalty / own goal | `⚽ Penalty! CRY 1 – 3 LIV` |
| Red card | `🟥 Red card — Ronald Araujo` · *Liverpool 71'* |
| Substitution | `🔄 Crystal Palace 60'` · *Darío Osorio replaces Quinten Timber* |
| Kick-off | `🔴 Kick-off: LIV @ CRY` |
| Half-time / restarts | `⏸ Halftime: CRY 0 – 1 LIV` |
| Full time | `🏁 Full time: CRY 1 – 3 LIV` |
| Yellow card | off by default — there are a lot of them |
| Missed penalty, VAR call | `⚠️ Penalty - Saved 63'` |

**Cricket**

| Moment | Example notification |
|---|---|
| Wicket | `🏏 WICKET — Hugo Burdon 70 (148)` · *QLD 138/3 · Riley Meredith* |
| Batter 50 / 100 / 150 / 200 | `💯 HUNDRED — Jack Clayton` · *104 off 142 (12x4, 1x6)* |
| Team total past each 50 | `🏏 QLD past 150` |
| Bowling haul (3/5/7/10) | `🎯 Riley Meredith — 5 wickets` |
| First ball | `🔴 Play underway: QLD v TAS` |
| Innings break | `🏏 2nd innings: TAS 0/0` |
| Result | `🏁 QLD 348 & 19/0 | TAS 133 & 233` · *Queensland won by 10 wickets* |
| Fours & sixes | off by default — a T20 would buzz 30 times |

Every moment is a separate switch on the page, so you can keep goals and wickets and drop
the rest. There is also an optional score summary every 5–60 minutes while your matches
are live.

When two things happen inside one poll, the more important one gets the notification
(a goal outranks a substitution) and the rest arrive as one grouped follow-up.
Updates for the same match reuse one notification slot, so your lock screen shows the
current state instead of a stack of stale scores.

### How "real time" works

Two tiers of data from [ESPN's public feed](https://site.api.espn.com) (no API key):

1. **Scoreboard**, one request per league: who is playing, the score, and the
   scheduled → live → finished transitions.
2. **Detail feed**, one request per *live* match: football `keyEvents` (scorers, cards,
   subs) and cricket ball-by-ball (wickets, every batter's running total, bowler figures).

Polling runs **every 20 seconds while a followed match is live** and drops to every 3
minutes when nothing is on, so an idle day costs almost nothing. End to end you should see
a goal or wicket within roughly 20–60 seconds of it happening — ESPN's own feed adds a few
seconds of its own.

If a detail request fails the scoreboard still produces goal and wicket alerts by itself,
so a hiccup degrades the detail rather than going silent. On first contact with a match
the feeds are only recorded as a baseline, never announced — restarting the server or
following a match at half-time will not replay what already happened.

### Leagues

Football: Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga,
Championship, FA Cup, Carabao Cup, Champions/Europa/Conference League, Nations League,
FIFA World Cup + UEFA qualifying, AFCON, Indian Super League, MLS, Liga MX.

Cricket: IPL, ICC Cricket World Cup, Champions Trophy, Big Bash, Sheffield Shield,
Ranji Trophy, County Championship, T20 Blast.

Any other ESPN cricket or football competition can be added in the page's **Other ESPN
league** box using the id from its scoreboard URL, e.g. `cricket/8082` or `soccer/bra.1`.

### HTTP API

```
GET  /sports/leagues                     league catalogue + alert kinds
GET  /sports/teams?league=soccer/eng.1   team list for picking favourites
GET  /sports/live?leagues=a,b            current matches (cached ~20s)
GET  /sports/validate?league=cricket/123 check a custom league id
POST /sports/subscribe   {userId, subscription, prefs}
GET  /sports/prefs?userId=...
POST /sports/prefs       {userId, prefs}
POST /sports/unsubscribe {userId}
POST /sports/test        {userId}        send yourself a test notification
POST /sports/poll-now                   force a poll cycle
```

`prefs` is `{ leagues: [...], teams: { league: [teamId] }, football: {...}, cricket: {...},
digestMinutes }`, where the two sport blocks hold one boolean per moment. Older flat
`events` prefs are migrated automatically.

## Deploying

`render.yaml` deploys the backend as a free Render web service (`npm install`,
`node server.js`). It serves the `frontend/` folder too, so the page and the push server
share one origin.

Set these in the Render dashboard so phones don't have to re-subscribe after every deploy
— the server prints a fresh pair on first boot if they're missing:

```
VAPID_PUBLIC_KEY          = ...
VAPID_PRIVATE_KEY         = ...
SPORTS_LIVE_POLL_SECONDS  = 20    # optional: cadence while a match is live
SPORTS_IDLE_POLL_SECONDS  = 180   # optional: cadence when nothing is on
```

### Free-tier caveats

- **Sleeping:** a free Render service spins down when idle, and a sleeping server polls
  nothing. The built-in self-ping (every 10 min via `RENDER_EXTERNAL_URL`) keeps it awake.
- **Disk is wiped on redeploy**, which clears `backend/.data` (subscriptions, match
  snapshots and feed cursors). The page re-registers your subscription every time you open it, so open it
  once after a deploy. For set-and-forget durability, move `store` to a managed database.
- After a restart the first poll of each league only records a baseline, so you never get
  a burst of stale "goals" for matches that finished hours ago.

## Reminders (original feature)

The reminder endpoints are unchanged: `POST /subscribe`, `POST /sync`,
`POST /acknowledge`, `POST /snooze`, `DELETE /reminder/:id`. Due reminders re-push every
2 minutes until acknowledged, for up to an hour.
