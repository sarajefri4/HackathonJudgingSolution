const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const db      = require('../db');

// POST /api/auth/admin
router.post('/admin', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  // Falls back to 2021 when no ADMIN_PIN is set in .env.
  if (String(pin) !== String(process.env.ADMIN_PIN || '2021')) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  req.session.isAdmin = true;
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ success: true });
  });
});

// POST /api/auth/judge
router.post('/judge', async (req, res) => {
  const { judgeId, pin } = req.body;
  if (!judgeId || !pin) {
    return res.status(400).json({ error: 'judgeId and PIN required' });
  }

  try {
    const judge = await db.get('SELECT * FROM judges WHERE id = ?', [judgeId]);
    if (!judge) return res.status(404).json({ error: 'Judge not found' });

    if (!judge.pin_hash) {
      return res.status(401).json({ error: 'No PIN set for this judge — contact admin.' });
    }

    const valid = await bcrypt.compare(String(pin), judge.pin_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid PIN' });

    req.session.judgeId   = judge.id;
    req.session.judgeName = judge.name;
    req.session.dayId     = judge.day_id;
    req.session.save(err => {
      if (err) return res.status(500).json({ error: 'Session error' });
      res.json({ success: true, judge: { id: judge.id, name: judge.name, dayId: judge.day_id } });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session.isAdmin) {
    return res.json({ type: 'admin' });
  }
  if (req.session.judgeId) {
    return res.json({
      type:      'judge',
      judgeId:   req.session.judgeId,
      judgeName: req.session.judgeName,
      dayId:     req.session.dayId,
    });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

module.exports = router;
