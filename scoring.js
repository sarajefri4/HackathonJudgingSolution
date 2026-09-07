/**
 * Rubric helpers shared by the score and admin routes.
 *
 * Criteria are admin-editable rows, so every total is computed from whatever
 * criteria exist at the time. Weights are treated as *relative*: they are
 * normalised by their sum, so a rubric whose weights add up to 90 or 120 still
 * produces a 0–100 total. An empty rubric yields a total of 0.
 */
const db = require('./db');

/** All criteria in display order. */
function loadCriteria() {
  return db.all('SELECT * FROM criteria ORDER BY position, id');
}

/**
 * Weighted 0–100 total.
 * @param {Array} criteria rows from `criteria`
 * @param {Map|Object} values criterion id → raw score
 */
function computeTotal(criteria, values) {
  const get = id => (values instanceof Map ? values.get(id) : values[id]);

  const weightSum = criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
  if (weightSum <= 0) return 0;

  const weighted = criteria.reduce((sum, c) => {
    const max = Number(c.max_score) || 10;
    const raw = Number(get(c.id)) || 0;
    const clamped = Math.min(Math.max(raw, 0), max);
    return sum + (clamped / max) * (Number(c.weight) || 0);
  }, 0);

  return (weighted / weightSum) * 100;
}

/**
 * Recompute and persist `scores.total` for every submitted score.
 * Must be called after the rubric changes — otherwise stored totals are stale
 * relative to the new weights/criteria.
 */
async function recomputeAllTotals() {
  const criteria = await loadCriteria();
  const scores   = await db.all('SELECT id FROM scores');
  if (scores.length === 0) return;

  const rows = await db.all('SELECT score_id, criterion_id, value FROM score_values');
  const byScore = new Map();
  for (const r of rows) {
    if (!byScore.has(r.score_id)) byScore.set(r.score_id, new Map());
    byScore.get(r.score_id).set(r.criterion_id, r.value);
  }

  for (const s of scores) {
    const total = computeTotal(criteria, byScore.get(s.id) || new Map());
    await db.run('UPDATE scores SET total = ? WHERE id = ?', [total, s.id]);
  }
}

module.exports = { loadCriteria, computeTotal, recomputeAllTotals };
