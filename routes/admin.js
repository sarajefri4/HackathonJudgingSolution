const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const db      = require('../db');
const { loadCriteria, recomputeAllTotals } = require('../scoring');

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin access required' });
  }
  next();
}

/* ── GET /api/admin/config ────────────────────────────────────────────────
   Everything the setup page needs: event branding, days, teams, judges and
   the rubric. */
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const configRows = await db.all('SELECT key, value FROM config');
    const event = Object.fromEntries(configRows.map(r => [r.key, r.value]));

    const days   = await db.all('SELECT * FROM days ORDER BY id');
    const teams  = await db.all('SELECT * FROM teams ORDER BY day_id, id');
    const judges = await db.all(
      `SELECT id, name, day_id,
              CASE WHEN pin_hash IS NOT NULL THEN 1 ELSE 0 END AS has_pin
       FROM judges ORDER BY day_id, id`
    );
    const criteria = await loadCriteria();

    res.json({ event, days, teams, judges, criteria });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── POST /api/admin/setup ────────────────────────────────────────────────
   Body: {
     event:    { event_name, event_tagline },
     days:     [ { id?, name, date, teams: [{id?, name}], judges: [{id?, name, pin?}] } ],
     criteria: [ { id?, label, description, weight, maxScore } ]
   }
   Days, teams, judges and criteria are all reconciled against what's sent:
   anything omitted is deleted. */
router.post('/setup', requireAdmin, async (req, res) => {
  const { days, criteria, event } = req.body;

  if (!Array.isArray(days)) {
    return res.status(400).json({ error: 'Expected { days: [...] }' });
  }
  if (criteria !== undefined && !Array.isArray(criteria)) {
    return res.status(400).json({ error: 'criteria must be an array' });
  }
  if (Array.isArray(criteria)) {
    const named = criteria.filter(c => c.label?.trim());
    if (named.length === 0) {
      return res.status(400).json({ error: 'At least one judging criterion is required' });
    }
    for (const c of named) {
      const w = parseFloat(c.weight);
      const m = parseFloat(c.maxScore ?? c.max_score);
      if (!isFinite(w) || w <= 0) {
        return res.status(400).json({ error: `Weight for "${c.label.trim()}" must be a number greater than 0` });
      }
      if (!isFinite(m) || m <= 0) {
        return res.status(400).json({ error: `Max rating for "${c.label.trim()}" must be a number greater than 0` });
      }
    }
  }

  try {
    // Hash PINs before opening the transaction — bcrypt is slow.
    const prepared = await Promise.all(days.map(async dayData => {
      const judges = await Promise.all((dayData.judges || []).map(async j => {
        if (j.pin && String(j.pin).trim()) {
          return { ...j, pin_hash: await bcrypt.hash(String(j.pin).trim(), 12) };
        }
        return j;
      }));
      return { ...dayData, judges };
    }));

    await db.transaction(async () => {
      // ── Event branding ───────────────────────────────────────────────────
      if (event && typeof event === 'object') {
        for (const key of ['event_name', 'event_tagline']) {
          if (typeof event[key] === 'string' && event[key].trim()) {
            await db.run(
              `INSERT INTO config (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              [key, event[key].trim()]
            );
          }
        }
      }

      // ── Days ─────────────────────────────────────────────────────────────
      // Delete days the admin removed (cascades to teams, judges and scores).
      const keepDayIds = prepared.filter(d => d.id).map(d => Number(d.id));
      if (keepDayIds.length > 0) {
        const ph = keepDayIds.map(() => '?').join(',');
        await db.run(`DELETE FROM days WHERE id NOT IN (${ph})`, keepDayIds);
      } else {
        await db.run('DELETE FROM days');
      }

      for (const dayData of prepared) {
        const name = (dayData.name || '').trim();
        const date = (dayData.date || '').trim();
        if (!name) continue;

        let dayId;
        if (dayData.id) {
          dayId = Number(dayData.id);
          const existing = await db.get('SELECT id FROM days WHERE id = ?', [dayId]);
          if (!existing) throw new Error(`Day ${dayId} not found`);
          await db.run('UPDATE days SET name = ?, date = ? WHERE id = ?', [name, date, dayId]);
        } else {
          ({ lastID: dayId } = await db.run(
            'INSERT INTO days (name, date) VALUES (?, ?)', [name, date]
          ));
        }

        const dayTeams  = dayData.teams  || [];
        const dayJudges = dayData.judges || [];

        // ── Teams ──────────────────────────────────────────────────────────
        const keepTeamIds = dayTeams.filter(t => t.id).map(t => Number(t.id));
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
        const keepJudgeIds = dayJudges.filter(j => j.id).map(j => Number(j.id));
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

      // ── Criteria ─────────────────────────────────────────────────────────
      if (Array.isArray(criteria)) {
        const rubric = criteria.filter(c => c.label?.trim());

        // Removing a criterion drops its recorded values (ON DELETE CASCADE).
        const keepIds = rubric.filter(c => c.id).map(c => Number(c.id));
        if (keepIds.length > 0) {
          const ph = keepIds.map(() => '?').join(',');
          await db.run(`DELETE FROM criteria WHERE id NOT IN (${ph})`, keepIds);
        } else {
          await db.run('DELETE FROM criteria');
        }

        for (const [i, c] of rubric.entries()) {
          const label  = c.label.trim();
          const desc   = (c.description || '').trim();
          const weight = parseFloat(c.weight);
          const max    = parseFloat(c.maxScore ?? c.max_score);

          if (c.id) {
            await db.run(
              `UPDATE criteria SET label = ?, description = ?, weight = ?, max_score = ?, position = ?
               WHERE id = ?`,
              [label, desc, weight, max, i, c.id]
            );
          } else {
            await db.run(
              `INSERT INTO criteria (label, description, weight, max_score, position)
               VALUES (?, ?, ?, ?, ?)`,
              [label, desc, weight, max, i]
            );
          }
        }

        // Clamp any already-recorded value that now exceeds its criterion's max.
        await db.run(`
          UPDATE score_values
          SET value = (SELECT max_score FROM criteria WHERE id = score_values.criterion_id)
          WHERE value > (SELECT max_score FROM criteria WHERE id = score_values.criterion_id)
        `);
      }
    });

    // Weights/criteria may have changed — stored totals would otherwise be stale.
    if (Array.isArray(criteria)) await recomputeAllTotals();

    res.json({ success: true });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/admin/dashboard/:dayId ─────────────────────────────────────── */
router.get('/dashboard/:dayId', requireAdmin, async (req, res) => {
  const { dayId } = req.params;

  try {
    const day = await db.get('SELECT * FROM days WHERE id = ?', [dayId]);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    const teams    = await db.all('SELECT * FROM teams  WHERE day_id = ? ORDER BY id', [dayId]);
    const judges   = await db.all('SELECT id, name FROM judges WHERE day_id = ? ORDER BY id', [dayId]);
    const criteria = await loadCriteria();

    const scores = await db.all(`
      SELECT s.id, s.judge_id, s.team_id, s.total, s.notes, s.submitted_at,
             j.name AS judge_name, t.name AS team_name
      FROM scores s
      JOIN judges j ON s.judge_id = j.id
      JOIN teams  t ON s.team_id  = t.id
      WHERE j.day_id = ? AND t.day_id = ?
      ORDER BY t.id, j.id
    `, [dayId, dayId]);

    // Attach each score's per-criterion values as { criterionId: value }.
    if (scores.length > 0) {
      const ph   = scores.map(() => '?').join(',');
      const vals = await db.all(
        `SELECT score_id, criterion_id, value FROM score_values WHERE score_id IN (${ph})`,
        scores.map(s => s.id)
      );
      const byScore = new Map();
      for (const v of vals) {
        if (!byScore.has(v.score_id)) byScore.set(v.score_id, {});
        byScore.get(v.score_id)[v.criterion_id] = v.value;
      }
      for (const s of scores) s.values = byScore.get(s.id) || {};
    }

    const teamAverages = teams.map(team => {
      const ts = scores.filter(s => s.team_id === team.id);
      if (ts.length === 0) return { teamId: team.id, teamName: team.name, average: null, count: 0 };
      const avg = ts.reduce((sum, s) => sum + s.total, 0) / ts.length;
      return { teamId: team.id, teamName: team.name, average: avg, count: ts.length };
    });

    res.json({ day, teams, judges, criteria, scores, teamAverages, totalJudges: judges.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── GET /api/admin/export/:dayId — CSV download ─────────────────────────── */
router.get('/export/:dayId', requireAdmin, async (req, res) => {
  const { dayId } = req.params;

  try {
    const day = await db.get('SELECT * FROM days WHERE id = ?', [dayId]);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    const criteria = await loadCriteria();

    const rows = await db.all(`
      SELECT s.id, d.name AS day, j.name AS judge, t.name AS team,
             s.total, s.notes, s.submitted_at
      FROM scores s
      JOIN judges j ON s.judge_id = j.id
      JOIN teams  t ON s.team_id  = t.id
      JOIN days   d ON j.day_id   = d.id
      WHERE j.day_id = ? AND t.day_id = ?
      ORDER BY t.id, j.id
    `, [dayId, dayId]);

    const byScore = new Map();
    if (rows.length > 0) {
      const ph   = rows.map(() => '?').join(',');
      const vals = await db.all(
        `SELECT score_id, criterion_id, value FROM score_values WHERE score_id IN (${ph})`,
        rows.map(r => r.id)
      );
      for (const v of vals) {
        if (!byScore.has(v.score_id)) byScore.set(v.score_id, {});
        byScore.get(v.score_id)[v.criterion_id] = v.value;
      }
    }

    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

    // One column per criterion, labelled with its weight share.
    const weightSum = criteria.reduce((s, c) => s + c.weight, 0) || 1;
    const header = [
      'Day', 'Judge', 'Team',
      ...criteria.map(c => `${c.label} (${Math.round(c.weight / weightSum * 100)}%, /${c.max_score})`),
      'Total', 'Notes', 'Submitted At',
    ];

    const lines = [
      header.join(','),
      ...rows.map(r => {
        const values = byScore.get(r.id) || {};
        return [
          escape(r.day), escape(r.judge), escape(r.team),
          ...criteria.map(c => values[c.id] ?? 0),
          r.total.toFixed(2), escape(r.notes), escape(r.submitted_at),
        ].join(',');
      }),
    ];

    const filename = `${day.name.toLowerCase().replace(/\s+/g, '-')}-scores.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
