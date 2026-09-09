require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const path         = require('path');
const db           = require('./db');
const SqliteStore  = require('./session-store');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '2021';

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  // Sessions live in the database, not in memory, so a restart doesn't sign
  // every judge out at once.
  store:             new SqliteStore(),
  secret:            process.env.SESSION_SECRET || 'datathon-judging-secret',
  resave:            false,
  saveUninitialized: false,
  rolling:           true,   // refresh the 24h window on each request
  cookie: {
    maxAge:   24 * 60 * 60 * 1000, // 24 h
    httpOnly: true,
    // 'lax', not 'strict': judges often arrive from a QR code or a link pasted
    // into a chat app, and 'strict' withholds the cookie on that first
    // navigation, making them look signed out. Cross-site POSTs still send no
    // cookie, so CSRF protection is unchanged.
    sameSite: 'lax',
  },
}));

// ── Static assets ───────────────────────────────────────────────────────────
// Pages and scripts are served no-store. Judges keep the app open on phones and
// tablets for hours; without this a device can hold a cached copy of the login
// script from before a fix and keep failing in ways nobody can reproduce.
app.use((req, res, next) => {
  if (/\.(html|js|css)$/.test(req.path) || !path.extname(req.path)) {
    res.set('Cache-Control', 'no-store, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/admin',  require('./routes/admin'));
app.use('/api/scores', require('./routes/scores'));
app.use('/api/finals', require('./routes/finals'));
app.use('/api/vote',   require('./routes/vote'));

// Public lookups (no auth required)

// Event branding — used by the landing page and headers.
app.get('/api/config', async (req, res) => {
  try {
    const rows = await db.all('SELECT key, value FROM config');
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// The rubric judges score against.
app.get('/api/criteria', async (req, res) => {
  try {
    res.json(await db.all('SELECT * FROM criteria ORDER BY position, id'));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/days', async (req, res) => {
  try {
    res.json(await db.all('SELECT * FROM days ORDER BY id'));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/days/:dayId/teams', async (req, res) => {
  try {
    res.json(await db.all('SELECT * FROM teams WHERE day_id = ? ORDER BY id', [req.params.dayId]));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/days/:dayId/judges', async (req, res) => {
  try {
    // Never expose pin_hash
    res.json(await db.all('SELECT id, name FROM judges WHERE day_id = ? ORDER BY id', [req.params.dayId]));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── HTML page routes ─────────────────────────────────────────────────────────
const htmlDir = path.join(__dirname, 'public');

app.get('/',              (_, res) => res.sendFile(path.join(htmlDir, 'index.html')));
app.get('/admin-setup',   (_, res) => res.sendFile(path.join(htmlDir, 'admin-setup.html')));
app.get('/admin-dashboard', (_, res) => res.sendFile(path.join(htmlDir, 'admin-dashboard.html')));
app.get('/judge-login',   (_, res) => res.sendFile(path.join(htmlDir, 'judge-login.html')));
app.get('/score',         (_, res) => res.sendFile(path.join(htmlDir, 'score.html')));
app.get('/finals-dashboard', (_, res) => res.sendFile(path.join(htmlDir, 'finals-dashboard.html')));
app.get('/vote',          (_, res) => res.sendFile(path.join(htmlDir, 'vote.html')));

// ── Start (wait for DB init) ─────────────────────────────────────────────────
db._ready.then(() => {
  app.listen(PORT, () => {
    console.log(`\n  Datathon Judging App`);
    console.log(`  ─────────────────────────────────────`);
    console.log(`  Local:     http://localhost:${PORT}`);
    console.log(`  Admin PIN: ${ADMIN_PIN}`);
    for (const [name, addrs] of Object.entries(require('os').networkInterfaces())) {
      for (const a of addrs || []) {
        if (a.family === 'IPv4' && !a.internal) {
          console.log(`  Network:   http://${a.address}:${PORT}  (${name})`);
        }
      }
    }
    console.log(`\n  → Open in browser or share your LAN IP with judges\n`);
  });
});
