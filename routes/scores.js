const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { loadCriteria, computeTotal } = require('../scoring');

function requireJudge(req, res, next) {
  if (!req.session.judgeId) {
    return res.status(401).json({ error: 'Judge login required' });
  }
  next();
}

/* ── GET /api/scores/my-scores ───────────────────────────────────────────── */
router.get('/my-scores', requireJudge, async (req, res) => {
  const { judgeId, dayId } = req.session;
  try {
    const scores = await db.all(`
      SELECT s.id, s.judge_id, s.team_id, s.total, s.notes, s.submitted_at,
             t.name AS team_name
      FROM scores s
      JOIN teams t ON s.team_id = t.id
      WHERE s.judge_id = ? AND t.day_id = ?
    `, [judgeId, dayId]);

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

    res.json(scores);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── POST /api/scores ─────────────────────────────────────────────────────
   Body: { teamId, notes, values: { <criterionId>: number } } */
router.post('/', requireJudge, async (req, res) => {
  const { judgeId } = req.session;
  const { teamId, notes, values } = req.body;

  if (!teamId) return res.status(400).json({ error: 'teamId required' });
  if (!values || typeof values !== 'object') {
    return res.status(400).json({ error: 'values required' });
  }

  try {
    const criteria = await loadCriteria();
    if (criteria.length === 0) {
      return res.status(400).json({ error: 'No judging criteria configured — contact admin.' });
    }

    // Validate every criterion against its own scale.
    const clean = {};
    for (const c of criteria) {
      const raw = parseFloat(values[c.id]);
      const n   = isNaN(raw) ? 0 : raw;
      if (n < 0 || n > c.max_score) {
        return res.status(400).json({
          error: `${c.label} must be between 0 and ${c.max_score}`,
        });
      }
      clean[c.id] = n;
    }

    // Verify this team belongs to the judge's day.
    const team = await db.get(`
      SELECT t.* FROM teams t
      JOIN judges j ON j.day_id = t.day_id
      WHERE t.id = ? AND j.id = ?
    `, [teamId, judgeId]);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const total = computeTotal(criteria, clean);

    await db.transaction(async () => {
      await db.run(`
        INSERT INTO scores (judge_id, team_id, total, notes, submitted_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(judge_id, team_id) DO UPDATE SET
          total        = excluded.total,
          notes        = excluded.notes,
          submitted_at = datetime('now')
      `, [judgeId, teamId, total, notes || '']);

      const { id: scoreId } = await db.get(
        'SELECT id FROM scores WHERE judge_id = ? AND team_id = ?', [judgeId, teamId]
      );

      for (const c of criteria) {
        await db.run(`
          INSERT INTO score_values (score_id, criterion_id, value)
          VALUES (?, ?, ?)
          ON CONFLICT(score_id, criterion_id) DO UPDATE SET value = excluded.value
        `, [scoreId, c.id, clean[c.id]]);
      }
    });

    res.json({ success: true, total: parseFloat(total.toFixed(2)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
