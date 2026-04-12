const express = require('express');
const router  = express.Router();
const db      = require('../db');

function requireJudge(req, res, next) {
  if (!req.session.judgeId) {
    return res.status(401).json({ error: 'Judge login required' });
  }
  next();
}

function calcTotal(impact, analysis, story, feasibility) {
  return (impact / 10 * 0.30 + analysis / 10 * 0.25 + story / 10 * 0.30 + feasibility / 10 * 0.15) * 100;
}

// GET /api/scores/my-scores
router.get('/my-scores', requireJudge, async (req, res) => {
  const { judgeId, dayId } = req.session;
  try {
    const scores = await db.all(`
      SELECT s.*, t.name AS team_name
      FROM scores s
      JOIN teams t ON s.team_id = t.id
      WHERE s.judge_id = ? AND t.day_id = ?
    `, [judgeId, dayId]);
    res.json(scores);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/scores
router.post('/', requireJudge, async (req, res) => {
  const { judgeId } = req.session;
  const { teamId, impact, analysis, story, feasibility, notes } = req.body;

  if (!teamId) return res.status(400).json({ error: 'teamId required' });

  const vals = [impact, analysis, story, feasibility].map(v => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  });

  for (const v of vals) {
    if (v < 0 || v > 10) {
      return res.status(400).json({ error: 'Score values must be 0–10' });
    }
  }

  try {
    // Verify this team belongs to the judge's day
    const team = await db.get(`
      SELECT t.* FROM teams t
      JOIN judges j ON j.day_id = t.day_id
      WHERE t.id = ? AND j.id = ?
    `, [teamId, judgeId]);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const [impactVal, analysisVal, storyVal, feasibilityVal] = vals;
    const total = calcTotal(impactVal, analysisVal, storyVal, feasibilityVal);

    await db.run(`
      INSERT INTO scores (judge_id, team_id, impact, analysis, story, feasibility, total, notes, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(judge_id, team_id) DO UPDATE SET
        impact       = excluded.impact,
        analysis     = excluded.analysis,
        story        = excluded.story,
        feasibility  = excluded.feasibility,
        total        = excluded.total,
        notes        = excluded.notes,
        submitted_at = datetime('now')
    `, [judgeId, teamId, impactVal, analysisVal, storyVal, feasibilityVal, total, notes || '']);

    res.json({ success: true, total: parseFloat(total.toFixed(2)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
