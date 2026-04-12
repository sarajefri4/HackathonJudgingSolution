const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const db      = require('../db');

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin access required' });
  }
  next();
}

// GET /api/admin/config
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const days   = await db.all('SELECT * FROM days ORDER BY id');
    const teams  = await db.all('SELECT * FROM teams ORDER BY day_id, id');
    const judges = await db.all(
      `SELECT id, name, day_id,
              CASE WHEN pin_hash IS NOT NULL THEN 1 ELSE 0 END AS has_pin
       FROM judges ORDER BY day_id, id`
    );
    res.json({ days, teams, judges });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/setup
// Body: { days: [ { dayId, teams: [{id?, name}], judges: [{id?, name, pin?}] } ] }
router.post('/setup', requireAdmin, async (req, res) => {
  const { days } = req.body;
  if (!Array.isArray(days)) {
    return res.status(400).json({ error: 'Expected { days: [...] }' });
  }

  try {
    // Hash PINs asynchronously first
    const prepared = await Promise.all(days.map(async dayData => {
      const judges = await Promise.all((dayData.judges || []).map(async j => {
        if (j.pin && j.pin.trim()) {
          return { ...j, pin_hash: await bcrypt.hash(j.pin.trim(), 12) };
        }
        return j;
      }));
      return { ...dayData, judges };
    }));

    // Perform all DB writes in a transaction
    await db.transaction(async () => {
      for (const { dayId, teams: dayTeams = [], judges: dayJudges = [] } of prepared) {
        const day = await db.get('SELECT id FROM days WHERE id = ?', [dayId]);
        if (!day) throw new Error(`Day ${dayId} not found`);

        // ── Teams ──────────────────────────────────────────────────────────
        const keepTeamIds = dayTeams.filter(t => t.id).map(t => t.id);

        if (keepTeamIds.length > 0) {
          const ph = keepTeamIds.map(() => '?').join(',');
          await db.run(
            `DELETE FROM teams WHERE day_id = ? AND id NOT IN (${ph})`,
            [dayId, ...keepTeamIds]
          );
        } else {
          await db.run('DELETE FROM teams WHERE day_id = ?', [dayId]);
        }

        for (const team of dayTeams) {
          if (!team.name?.trim()) continue;
          if (team.id) {
            await db.run('UPDATE teams SET name = ? WHERE id = ? AND day_id = ?',
              [team.name.trim(), team.id, dayId]);
          } else {
            await db.run('INSERT INTO teams (name, day_id) VALUES (?, ?)',
              [team.name.trim(), dayId]);
          }
        }

        // ── Judges ─────────────────────────────────────────────────────────
        const keepJudgeIds = dayJudges.filter(j => j.id).map(j => j.id);

        if (keepJudgeIds.length > 0) {
          const ph = keepJudgeIds.map(() => '?').join(',');
          await db.run(
            `DELETE FROM judges WHERE day_id = ? AND id NOT IN (${ph})`,
            [dayId, ...keepJudgeIds]
          );
        } else {
          await db.run('DELETE FROM judges WHERE day_id = ?', [dayId]);
        }

        for (const judge of dayJudges) {
          if (!judge.name?.trim()) continue;
          if (judge.id) {
            if (judge.pin_hash) {
              await db.run('UPDATE judges SET name = ?, pin_hash = ? WHERE id = ? AND day_id = ?',
                [judge.name.trim(), judge.pin_hash, judge.id, dayId]);
            } else {
              await db.run('UPDATE judges SET name = ? WHERE id = ? AND day_id = ?',
                [judge.name.trim(), judge.id, dayId]);
            }
          } else {
            await db.run('INSERT INTO judges (name, day_id, pin_hash) VALUES (?, ?, ?)',
              [judge.name.trim(), dayId, judge.pin_hash || null]);
          }
        }
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/dashboard/:dayId
router.get('/dashboard/:dayId', requireAdmin, async (req, res) => {
  const { dayId } = req.params;

  try {
    const day = await db.get('SELECT * FROM days WHERE id = ?', [dayId]);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    const teams  = await db.all('SELECT * FROM teams  WHERE day_id = ? ORDER BY id', [dayId]);
    const judges = await db.all('SELECT id, name FROM judges WHERE day_id = ? ORDER BY id', [dayId]);

    const scores = await db.all(`
      SELECT s.*, j.name AS judge_name, t.name AS team_name
      FROM scores s
      JOIN judges j ON s.judge_id = j.id
      JOIN teams  t ON s.team_id  = t.id
      WHERE j.day_id = ? AND t.day_id = ?
      ORDER BY t.id, j.id
    `, [dayId, dayId]);

    const teamAverages = teams.map(team => {
      const ts = scores.filter(s => s.team_id === team.id);
      if (ts.length === 0) return { teamId: team.id, teamName: team.name, average: null, count: 0 };
      const avg = ts.reduce((sum, s) => sum + s.total, 0) / ts.length;
      return { teamId: team.id, teamName: team.name, average: avg, count: ts.length };
    });

    res.json({ day, teams, judges, scores, teamAverages, totalJudges: judges.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/export/:dayId — CSV download
router.get('/export/:dayId', requireAdmin, async (req, res) => {
  const { dayId } = req.params;

  try {
    const day = await db.get('SELECT * FROM days WHERE id = ?', [dayId]);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    const rows = await db.all(`
      SELECT
        d.name        AS day,
        j.name        AS judge,
        t.name        AS team,
        s.impact,
        s.analysis,
        s.story,
        s.feasibility,
        s.total,
        s.notes,
        s.submitted_at
      FROM scores s
      JOIN judges j ON s.judge_id = j.id
      JOIN teams  t ON s.team_id  = t.id
      JOIN days   d ON j.day_id   = d.id
      WHERE j.day_id = ? AND t.day_id = ?
      ORDER BY t.id, j.id
    `, [dayId, dayId]);

    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Day', 'Judge', 'Team',
      'Business Impact', 'Quality of Analysis', 'Storytelling', 'Feasibility',
      'Total', 'Notes', 'Submitted At',
    ];

    const lines = [
      header.join(','),
      ...rows.map(r => [
        escape(r.day), escape(r.judge), escape(r.team),
        r.impact, r.analysis, r.story, r.feasibility,
        r.total.toFixed(2), escape(r.notes), escape(r.submitted_at),
      ].join(',')),
    ];

    const filename = `datathon-${day.name.toLowerCase().replace(/\s+/g, '-')}-scores.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
