# Datathon 2025 — Judging App

A full-stack web application for running structured, PIN-authenticated judging sessions at a datathon event. Judges score teams on four weighted criteria from a tablet or any modern browser.

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
3. Add teams and judges for **Day 1** (April 20) and **Day 2** (April 21)
4. Set a PIN for each judge
5. Click **Save Configuration**
6. Click **Dashboard** to monitor scores

### Judging

1. Go to **http://localhost:3000** → click **I'm a Judge**
2. Select your day, then your name
3. Enter your PIN
4. Score each team using the 0–10 sliders for each criterion
5. Press **Submit Score** — the app auto-advances to the next unscored team
6. You can return to any team to review or update your score

### Admin Dashboard

- **Leaderboard**: teams ranked by average score across all judges
- **Score Grid**: judge × team matrix showing every submitted score
- Scores refresh automatically every 30 seconds
- **Export CSV**: downloads all scores for the selected day

---

## Scoring Rubric

| Criterion            | Weight | Description |
|----------------------|--------|-------------|
| Business Impact      | 30%    | How meaningful, actionable, and relevant is the insight? |
| Quality of Analysis  | 25%    | How effectively was Sigma used to derive the insight? |
| Storytelling         | 30%    | How clearly and compellingly is the insight communicated? |
| Feasibility          | 15%    | Can the insight realistically be acted upon? |

**Formula:** `total = (impact/10 × 0.30 + analysis/10 × 0.25 + story/10 × 0.30 + feasibility/10 × 0.15) × 100`

---

## Project Structure

```
├── server.js          # Express app & routing
├── db.js              # SQLite setup (better-sqlite3)
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
| POST   | `/api/auth/admin`             | —      | Admin PIN login                    |
| POST   | `/api/auth/judge`             | —      | Judge PIN login                    |
| GET    | `/api/auth/me`                | —      | Get current session                |
| POST   | `/api/auth/logout`            | —      | Destroy session                    |
| GET    | `/api/days`                   | —      | List days                          |
| GET    | `/api/days/:id/teams`         | —      | List teams for a day               |
| GET    | `/api/days/:id/judges`        | —      | List judge names for a day         |
| GET    | `/api/admin/config`           | Admin  | Full config (teams + judges)       |
| POST   | `/api/admin/setup`            | Admin  | Save configuration                 |
| GET    | `/api/admin/dashboard/:dayId` | Admin  | All scores + aggregates for a day  |
| GET    | `/api/admin/export/:dayId`    | Admin  | Download CSV                       |
| GET    | `/api/scores/my-scores`       | Judge  | Judge's submitted scores           |
| POST   | `/api/scores`                 | Judge  | Submit or update a score           |

---

## CSV Export Columns

`Day, Judge, Team, Business Impact, Quality of Analysis, Storytelling, Feasibility, Total, Notes, Submitted At`

---

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 4
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Auth:** bcrypt-hashed PINs + express-session
- **Frontend:** Vanilla HTML/CSS/JS — no framework
- **Fonts:** DM Serif Display + DM Sans (downloaded locally for offline use)

---

## Resetting the Database

Stop the server, then delete `data/judging.db`. On next start a fresh database with the two default days is created automatically.

```bash
rm data/judging.db
npm start
```
