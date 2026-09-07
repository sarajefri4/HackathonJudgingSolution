# Datathon 2025 — Judging App

A full-stack web application for running structured, PIN-authenticated judging sessions at a hackathon or datathon. Everything is configurable from the admin panel — the event name, how many days run, the teams and judges on each day, and the judging criteria themselves (add, remove, re-weight, and set each one's rating scale). Judges score from a tablet or any modern browser.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set:

| Variable         | Default | Description                              |
|------------------|---------|------------------------------------------|
| `ADMIN_PIN`      | `2021`  | Master PIN for the admin panel           |

If no `.env` exists, the admin PIN falls back to `2021` so the app still runs — but set
`SESSION_SECRET` before using it anywhere beyond a local network.
| `SESSION_SECRET` | —       | **Change this** to a long random string  |
| `PORT`           | `3000`  | Port the server listens on               |

### 3. Download fonts (for offline use)

This step requires internet access and only needs to be run once.
After this, the app works fully offline on a local network.

```bash
npm run setup:fonts
```

### 4. Start the server

```bash
# Production
npm start

# Development (auto-restart on changes)
npm run dev
```

Open your browser to **http://localhost:3000** (or your machine's LAN IP for tablet access).

---

## Usage

### Admin Setup

1. Go to **http://localhost:3000** → click **Admin**
2. Enter the admin PIN (default: `2021`)
3. **Event** — set the event name and tagline shown on the home page and judge screens
4. **Judging Criteria** — add, remove or reorder criteria; set each one's weight and max rating
5. **Days** — add as many days as you need; each has its own teams and judges
6. Set a PIN for each judge
7. Click **Save Configuration**
8. Click **Dashboard** to monitor scores

Everything on this page is reconciled on save: anything you remove from a list is deleted.
Removing a **day** also deletes its teams, judges and their submitted scores; removing a
**criterion** deletes the scores judges recorded for it. Both prompt for confirmation first.

### Judging

1. Go to **http://localhost:3000** → click **I'm a Judge**
2. Select your day, then your name
3. Enter your PIN
4. Score each team using the sliders — one per criterion, each running 0 to that criterion's max rating
5. Press **Submit Score** — the app auto-advances to the next unscored team
6. You can return to any team to review or update your score

### Admin Dashboard

- **Leaderboard**: teams ranked by average score across all judges
- **Score Grid**: judge × team matrix showing every submitted score
- Scores refresh automatically every 30 seconds
- **Export CSV**: downloads all scores for the selected day

---

## Scoring Rubric

The rubric is **fully configurable** from Admin Setup → *Judging Criteria*. Each criterion has:

| Field           | Meaning |
|-----------------|---------|
| **Name**        | Shown as the slider's heading |
| **Description** | Optional guidance shown to judges under the name |
| **Weight**      | How much this criterion counts toward the 0–100 total |
| **Max rating**  | The top of this criterion's slider (10, 5, 100 — whatever you like) |

A fresh database is seeded with these four defaults, which you can change or delete:

| Criterion            | Weight | Max | Description |
|----------------------|--------|-----|-------------|
| Business Impact      | 30%    | 10  | How meaningful, actionable, and relevant is the insight? |
| Quality of Analysis  | 25%    | 10  | How effectively was Sigma used to derive the insight? |
| Storytelling         | 30%    | 10  | How clearly and compellingly is the insight communicated? |
| Feasibility          | 15%    | 10  | Can the insight realistically be acted upon? |

**Formula:** each criterion contributes its score as a fraction of its own max, weighted by
its share of the total weight:

```
total = Σ (value / max_rating × weight) / Σ weight × 100
```

Weights are **relative**, so they don't have to add up to 100 — a set of 30/30/30 is scored
identically to 10/10/10. The setup page shows the running total and tells you when it isn't 100.

### Changing the rubric mid-event

Editing weights or deleting a criterion **recalculates every submitted total immediately**, so
the leaderboard stays consistent. Lowering a criterion's max rating clamps any score already
above the new maximum.

Adding a criterion is the one case that needs judges' attention: existing scores have no value
recorded for it, so it counts as 0 until they score that team again. The judge's screen flags
those teams with a **Needs re-scoring** badge and excludes them from the "scored" count, so
nothing silently drags a team's total down.

---

## Project Structure

```
├── server.js          # Express app & routing
├── db.js              # SQLite setup, schema & seed data
├── scoring.js         # Rubric helpers: weighted total + total recalculation
├── routes/
│   ├── auth.js        # Login / session endpoints
│   ├── admin.js       # Admin setup & dashboard
│   └── scores.js      # Score submission
├── public/
│   ├── css/main.css   # All styles
│   ├── js/
│   │   ├── utils.js           # Shared helpers
│   │   ├── admin-setup.js
│   │   ├── admin-dashboard.js
│   │   ├── judge-login.js
│   │   └── score.js
│   ├── fonts/         # Downloaded by npm run setup:fonts
│   ├── index.html
│   ├── admin-setup.html
│   ├── admin-dashboard.html
│   ├── judge-login.html
│   └── score.html
├── scripts/
│   └── download-fonts.js   # Font downloader
├── data/
│   └── judging.db     # SQLite database (auto-created)
├── .env.example
└── package.json
```

---

## API Reference

| Method | Path                          | Auth   | Description                        |
|--------|-------------------------------|--------|------------------------------------|
| GET    | `/api/config`                 | —      | Event name & tagline               |
| GET    | `/api/criteria`               | —      | The judging criteria               |
| POST   | `/api/auth/admin`             | —      | Admin PIN login                    |
| POST   | `/api/auth/judge`             | —      | Judge PIN login                    |
| GET    | `/api/auth/me`                | —      | Get current session                |
| POST   | `/api/auth/logout`            | —      | Destroy session                    |
| GET    | `/api/days`                   | —      | List days                          |
| GET    | `/api/days/:id/teams`         | —      | List teams for a day               |
| GET    | `/api/days/:id/judges`        | —      | List judge names for a day         |
| GET    | `/api/admin/config`           | Admin  | Full config (event, days, teams, judges, criteria) |
| POST   | `/api/admin/setup`            | Admin  | Save configuration                 |
| GET    | `/api/admin/dashboard/:dayId` | Admin  | All scores + aggregates for a day  |
| GET    | `/api/admin/export/:dayId`    | Admin  | Download CSV                       |
| GET    | `/api/scores/my-scores`       | Judge  | Judge's submitted scores           |
| POST   | `/api/scores`                 | Judge  | Submit or update a score           |

---

## CSV Export Columns

`Day, Judge, Team, <one column per criterion>, Total, Notes, Submitted At`

Each criterion column is labelled with its weight share and max rating, e.g.
`Business Impact (30%, /10)`. The columns follow whatever rubric is configured at export time.

---

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 4
- **Database:** SQLite via [sqlite3](https://github.com/TryGhost/node-sqlite3)
- **Auth:** bcrypt-hashed PINs + express-session
- **Frontend:** Vanilla HTML/CSS/JS — no framework
- **Fonts:** DM Serif Display + DM Sans (downloaded locally for offline use)

---

## Resetting the Database

Stop the server, then delete `data/judging.db`. On next start a fresh database is created
automatically with two default days and the four default criteria.

```bash
rm data/judging.db
npm start
```
