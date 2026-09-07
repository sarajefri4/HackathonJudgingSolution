/**
 * express-session store backed by the app's own SQLite database.
 *
 * The default MemoryStore keeps sessions in the Node process, so any restart —
 * a crash, a nodemon reload after an edit, closing the laptop lid — signs every
 * judge out at once. Mid-event that looks like "everyone got kicked back to the
 * day selection screen". Persisting sessions to the database they are already
 * using removes that whole class of failure, with no extra dependency.
 */
const { Store } = require('express-session');
const db        = require('./db');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // matches the cookie's maxAge

class SqliteStore extends Store {
  constructor({ cleanupIntervalMs = 60 * 60 * 1000 } = {}) {
    super();

    // Drop expired rows periodically; unref so it never holds the process open.
    this._timer = setInterval(() => {
      db.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()])
        .catch(err => console.error('Session cleanup failed:', err));
    }, cleanupIntervalMs);
    this._timer.unref?.();
  }

  _expiry(session) {
    const cookieExpires = session?.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + (session?.cookie?.originalMaxAge ?? DEFAULT_TTL_MS);
  }

  get(sid, cb) {
    db.get('SELECT data, expires_at FROM sessions WHERE sid = ?', [sid])
      .then(row => {
        if (!row) return cb(null, null);
        if (row.expires_at <= Date.now()) {
          return db.run('DELETE FROM sessions WHERE sid = ?', [sid])
            .then(() => cb(null, null), () => cb(null, null));
        }
        // A row we can't parse is treated as no session rather than a hard
        // error, so one bad row can't lock a judge out of signing in again.
        let parsed = null;
        try { parsed = JSON.parse(row.data); } catch { parsed = null; }
        cb(null, parsed);
      })
      .catch(cb);
  }

  set(sid, session, cb = () => {}) {
    let data;
    try { data = JSON.stringify(session); }
    catch (err) { return cb(err); }

    db.run(
      `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
      [sid, data, this._expiry(session)]
    ).then(() => cb(null), cb);
  }

  destroy(sid, cb = () => {}) {
    db.run('DELETE FROM sessions WHERE sid = ?', [sid]).then(() => cb(null), cb);
  }

  touch(sid, session, cb = () => {}) {
    db.run('UPDATE sessions SET expires_at = ? WHERE sid = ?', [this._expiry(session), sid])
      .then(() => cb(null), cb);
  }

  length(cb) {
    db.get('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', [Date.now()])
      .then(row => cb(null, row.n), cb);
  }

  clear(cb = () => {}) {
    db.run('DELETE FROM sessions').then(() => cb(null), cb);
  }
}

module.exports = SqliteStore;
