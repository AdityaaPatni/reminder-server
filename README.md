# reminder-server

A tiny Node server that sends **Web Push** notifications, so updates arrive on your phone
even when the page is closed or swiped away. Nothing is installed from an app store.

It now does two things:

| Path | What it is |
|---|---|
| `/sports.html` | **Live Scores** — real-time sports updates as notifications |
| `/` | Penalty Kings (the game) |
| `/health` | status check |

## Live sports updates

Open `https://<your-app>.onrender.com/sports.html`, pick the leagues (and optionally the
exact teams) you care about, and tap **Turn on live updates**. That's it — you can close
the page.

**On iPhone/iPad you must add the page to your Home Screen first** (Share → Add to Home
Screen), then open it from that icon and turn updates on. iOS only allows web push for
home-screen pages. It's a shortcut of a few KB, not an app download. Requires iOS 16.4+.
On Android/desktop Chrome, Edge or Firefox it works straight from the browser tab.

### What gets pushed

The server polls [ESPN's public scoreboard feed](https://site.api.espn.com) every 60
seconds (no API key needed), compares each match with the last time it looked, and only
pushes the moments that matter:

- **Match starts** — kick-off / first ball / tip-off
- **Goals and wickets** — football goals, cricket wickets
- **Breaks** — half-time, innings break, end of quarter
- **Final score**
- **Optional score summary** every 5–60 minutes while your matches are live

Per-sport policy keeps it from becoming a firehose: football gets every goal, cricket
gets every wicket and innings change, and the high-scoring sports (NBA, NFL, NHL, MLB)
get period ends plus the final — their running score belongs in the summary, not in 200
separate buzzes. Several updates in the same minute collapse into one notification per
match, capped at three matches plus a merged "+N more".

Notifications for the same match reuse one notification slot, so your lock screen shows
the current score rather than a stack of stale ones.

### Leagues

~34 leagues are built in: Premier League, LaLiga, Serie A, Bundesliga, Ligue 1,
Eredivisie, Primeira Liga, Championship, FA Cup, Carabao Cup, Champions/Europa/
Conference League, Nations League, FIFA World Cup + UEFA qualifying, AFCON, ISL, MLS,
Liga MX, IPL, ICC World Cup, Champions Trophy, Big Bash, Sheffield Shield, Ranji Trophy,
County Championship, T20 Blast, NBA, WNBA, NFL, NCAA Football, NHL, MLB.

Anything else ESPN covers can be added in the page's **Other ESPN league** box using the
id from its scoreboard URL, e.g. `cricket/8082` or `soccer/bra.1`.

### HTTP API

```
GET  /sports/leagues                     built-in league catalogue
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

## Deploying

`render.yaml` deploys the backend as a free Render web service (`npm install`,
`node server.js`). It serves the `frontend/` folder too, so the page and the push server
share one origin.

Set these in the Render dashboard so phones don't have to re-subscribe after every deploy
— the server prints a fresh pair on first boot if they're missing:

```
VAPID_PUBLIC_KEY   = ...
VAPID_PRIVATE_KEY  = ...
SPORTS_POLL_SECONDS = 60      # optional, minimum 20
```

### Free-tier caveats

- **Sleeping:** a free Render service spins down when idle, and a sleeping server polls
  nothing. The built-in self-ping (every 10 min via `RENDER_EXTERNAL_URL`) keeps it awake.
- **Disk is wiped on redeploy**, which clears `backend/.data` (subscriptions and match
  snapshots). The page re-registers your subscription every time you open it, so open it
  once after a deploy. For set-and-forget durability, move `store` to a managed database.
- After a restart the first poll of each league only records a baseline, so you never get
  a burst of stale "goals" for matches that finished hours ago.

## Reminders (original feature)

The reminder endpoints are unchanged: `POST /subscribe`, `POST /sync`,
`POST /acknowledge`, `POST /snooze`, `DELETE /reminder/:id`. Due reminders re-push every
2 minutes until acknowledged, for up to an hour.
