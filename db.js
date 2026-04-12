/**
 * SQLite database layer using the `sqlite3` package.
 * Provides a thin promise wrapper so routes can use async/await.
 */
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');

const DB_DIR  = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'judging.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const rawDb = new sqlite3.Database(DB_PATH, err => {
  if (err) { console.error('DB open error:', err); process.exit(1); }
});

/* ── Promise helpers ─────────────────────────────────────────────────────── */
const db = {
  /** Execute a statement with no return value. */
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      rawDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  /** Return first matching row or undefined. */
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      rawDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  /** Return all matching rows. */
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      rawDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  /** Execute multiple statements (no params). */
  exec(sql) {
    return new Promise((resolve, reject) => {
      rawDb.exec(sql, err => { if (err) reject(err); else resolve(); });
    });
  },

  /** Run statements inside a serialized block — emulates a transaction. */
  async transaction(fn) {
    await db.run('BEGIN');
    try {
      await fn();
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  },
};

/* ── Schema init (runs once on startup) ─────────────────────────────────── */
async function initSchema() {
  await db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS days (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT    NOT NULL,
      day_id INTEGER NOT NULL,
      FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS judges (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT    NOT NULL,
      day_id   INTEGER NOT NULL,
      pin_hash TEXT,
      FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scores (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      judge_id     INTEGER NOT NULL,
      team_id      INTEGER NOT NULL,
      impact       REAL    NOT NULL DEFAULT 0,
      analysis     REAL    NOT NULL DEFAULT 0,
      story        REAL    NOT NULL DEFAULT 0,
      feasibility  REAL    NOT NULL DEFAULT 0,
      total        REAL    NOT NULL DEFAULT 0,
      notes        TEXT             DEFAULT '',
      submitted_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(judge_id, team_id),
      FOREIGN KEY (judge_id) REFERENCES judges(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id)  REFERENCES teams(id)  ON DELETE CASCADE
    );
  `);

  // Seed default days
  const row = await db.get('SELECT COUNT(*) AS cnt FROM days');
  if (row.cnt === 0) {
    await db.run("INSERT INTO days (name, date) VALUES ('Day 1', 'April 20')");
    await db.run("INSERT INTO days (name, date) VALUES ('Day 2', 'April 21')");
  }
}

/* Export the db object and the init promise so server.js can await startup. */
db._ready = initSchema().catch(err => {
  console.error('DB init error:', err);
  process.exit(1);
});

module.exports = db;
