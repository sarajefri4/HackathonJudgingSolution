const express = require('express');
const router  = express.Router();
const db      = require('../db');

// POST /api/auth/admin
router.post('/admin', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  // Falls back to 2021 when no ADMIN_PIN is set in .env.
  if (String(pin) !== String(process.env.ADMIN_PIN || '2021')) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  // Start a clean session. Without this, unlocking the admin panel on a browser
  // where a judge is signed in leaves BOTH identities on one session, and /me
  // reports admin — which bounced the judge off /score on every attempt.
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });

    req.session.isAdmin = true;
    req.session.save(err2 => {
      if (err2) return res.status(500).json({ error: 'Session error' });
      res.json({ success: true });
    });
  });
});

// POST /api/auth/judge
// Judges identify themselves by picking their name — there is no PIN.
router.post('/judge', async (req, res) => {
  const { judgeId } = req.body;
  if (!judgeId) return res.status(400).json({ error: 'judgeId required' });

  try {
    const judge = await db.get('SELECT id, name, day_id FROM judges WHERE id = ?', [judgeId]);
    if (!judge) {
      // The admin saved a config that removed or replaced this judge while the
      // login page was open, so the name the judge tapped no longer exists.
      return res.status(409).json({ error: 'The judge list was just updated — reload the page and pick your name again.' });
    }

    // Clean session for the same reason as the admin login above.
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error' });

      req.session.judgeId   = judge.id;
      req.session.judgeName = judge.name;
      req.session.dayId     = judge.day_id;
      req.session.save(err2 => {
        if (err2) return res.status(500).json({ error: 'Session error' });
        res.json({ success: true, judge: { id: judge.id, name: judge.name, dayId: judge.day_id } });
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  // A session is either an admin or a judge, never both — the login handlers
  // regenerate the session so the two can't overlap on a shared browser. Judge
  // is checked first so that any stale mixed session resolves in their favour.
  if (req.session.judgeId) {
    // Re-read the judge each time: an admin save may have renamed them, moved
    // them to another day, or removed them since they signed in.
    try {
      const judge = await db.get('SELECT id, name, day_id FROM judges WHERE id = ?', [req.session.judgeId]);
      if (!judge) {
        return req.session.destroy(() =>
          res.status(401).json({ error: 'Your judge account was removed by the admin. Please sign in again.' }));
      }
      req.session.judgeName = judge.name;
      req.session.dayId     = judge.day_id;
      return res.json({
        type:      'judge',
        judgeId:   judge.id,
        judgeName: judge.name,
        dayId:     judge.day_id,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }
  if (req.session.isAdmin) {
    return res.json({ type: 'admin' });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

module.exports = router;
