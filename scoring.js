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

/* ── People's Choice ─────────────────────────────────────────────────────── */

/** Judging average per team for a day, unscored teams last. */
async function teamJudgeAverages(dayId) {
  const rows = await db.all(`
    SELECT t.id AS team_id, t.name AS team_name,
           AVG(s.total) AS average,
           COUNT(s.id)  AS score_count
    FROM teams t
    LEFT JOIN scores s ON s.team_id = t.id
    LEFT JOIN judges j ON j.id = s.judge_id AND j.day_id = t.day_id
    WHERE t.day_id = ?
    GROUP BY t.id
    ORDER BY t.id
  `, [dayId]);

  return rows.map(r => ({
    teamId:     r.team_id,
    teamName:   r.team_name,
    average:    r.score_count > 0 ? r.average : null,
    scoreCount: r.score_count,
  }));
}

/** Rank teams by judging average, highest first; unscored teams sort last. */
function rankByJudging(teams) {
  return [...teams].sort((a, b) => {
    if (a.average === null && b.average === null) return a.teamId - b.teamId;
    if (a.average === null) return 1;
    if (b.average === null) return -1;
    if (b.average !== a.average) return b.average - a.average;
    return a.teamId - b.teamId;   // stable, predictable tie-break
  });
}

/** The configured judge/audience split, normalised to fractions summing to 1. */
async function loadWeights() {
  const rows = await db.all(
    "SELECT key, value FROM config WHERE key IN ('weight_judges','weight_audience')"
  );
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));

  let judges   = parseFloat(cfg.weight_judges);
  let audience = parseFloat(cfg.weight_audience);
  if (!isFinite(judges)   || judges   < 0) judges   = 70;
  if (!isFinite(audience) || audience < 0) audience = 30;

  const sum = judges + audience;
  if (sum <= 0) return { judges: 1, audience: 0, rawJudges: 100, rawAudience: 0 };
  return {
    judges:       judges / sum,
    audience:     audience / sum,
    rawJudges:    judges,
    rawAudience:  audience,
  };
}

/** How many finalists the automatic selection picks. */
async function loadFinalistCount() {
  const row = await db.get("SELECT value FROM config WHERE key = 'finalist_count'");
  const n = parseInt(row?.value, 10);
  return isFinite(n) && n > 0 ? n : 6;
}

/**
 * The finalists for a day: the admin's explicit list if one exists, otherwise
 * the top N by judging average.
 */
async function loadFinalists(dayId) {
  const chosen = await db.all(`
    SELECT f.team_id, f.position, t.name AS team_name
    FROM finalists f
    JOIN teams t ON t.id = f.team_id
    WHERE f.day_id = ?
    ORDER BY f.position, f.team_id
  `, [dayId]);

  const averages = await teamJudgeAverages(dayId);
  const byId = new Map(averages.map(a => [a.teamId, a]));

  if (chosen.length > 0) {
    return {
      isCustom: true,
      teams: chosen.map(c => byId.get(c.team_id) ||
        { teamId: c.team_id, teamName: c.team_name, average: null, scoreCount: 0 }),
    };
  }

  const n = await loadFinalistCount();
  return { isCustom: false, teams: rankByJudging(averages).slice(0, n) };
}

/**
 * Just the id and name of each finalist — the only thing the public vote page
 * needs. When the list has been frozen (which opening the vote does) this is a
 * single indexed join, so a room full of phones loading at once costs almost
 * nothing. Only the un-frozen fallback pays for the judging aggregate.
 */
async function loadFinalistTeams(dayId) {
  const chosen = await db.all(`
    SELECT f.team_id AS teamId, t.name AS teamName
    FROM finalists f
    JOIN teams t ON t.id = f.team_id
    WHERE f.day_id = ?
    ORDER BY f.position, f.team_id
  `, [dayId]);
  if (chosen.length > 0) return chosen;

  const { teams } = await loadFinalists(dayId);
  return teams.map(t => ({ teamId: t.teamId, teamName: t.teamName }));
}

/**
 * Write the current automatic selection into `finalists`, making it explicit.
 *
 * Opening the vote calls this so the line-up can't shift underneath a vote in
 * progress — a judge submitting a late score would otherwise be able to swap a
 * team out from under ballots already cast for it.
 */
async function freezeFinalists(dayId) {
  const existing = await db.get('SELECT 1 AS present FROM finalists WHERE day_id = ? LIMIT 1', [dayId]);
  if (existing) return false;                      // already an explicit list

  const { teams } = await loadFinalists(dayId);
  if (teams.length === 0) return false;

  await db.transaction(async () => {
    for (const [i, t] of teams.entries()) {
      await db.run(
        'INSERT OR IGNORE INTO finalists (day_id, team_id, position) VALUES (?, ?, ?)',
        [dayId, t.teamId, i]
      );
    }
  });
  return true;
}

/**
 * Combined standings for a day's finalists.
 *
 * The audience contribution is each team's share of all ballots cast,
 * expressed 0–100, so the two components live on the same scale before being
 * weighted. With no votes yet, every audience share is 0 and the ranking is
 * simply the judging ranking.
 */
async function finalStandings(dayId) {
  const [{ isCustom, teams }, weights] = await Promise.all([
    loadFinalists(dayId),
    loadWeights(),
  ]);

  const tallies = await db.all(
    'SELECT team_id, COUNT(*) AS votes FROM votes WHERE day_id = ? GROUP BY team_id',
    [dayId]
  );
  const voteBy = new Map(tallies.map(t => [t.team_id, t.votes]));

  // Ballots cast for teams that are currently finalists. A team dropped from
  // the list after voting started keeps its row in `votes`, but its ballots
  // must not inflate the denominator for everyone else.
  const totalVotes = teams.reduce((sum, t) => sum + (voteBy.get(t.teamId) || 0), 0);

  const rows = teams.map(t => {
    const votes         = voteBy.get(t.teamId) || 0;
    const audienceShare = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
    const judgeScore    = t.average ?? 0;
    return {
      teamId:     t.teamId,
      teamName:   t.teamName,
      judgeScore: t.average,
      scoreCount: t.scoreCount,
      votes,
      audienceShare,
      finalScore: judgeScore * weights.judges + audienceShare * weights.audience,
    };
  });

  rows.sort((a, b) => b.finalScore - a.finalScore || a.teamId - b.teamId);
  rows.forEach((r, i) => { r.rank = i + 1; });

  return { rows, totalVotes, weights, isCustom, hasVotes: totalVotes > 0 };
}

module.exports = {
  loadCriteria, computeTotal, recomputeAllTotals,
  teamJudgeAverages, rankByJudging, loadWeights, loadFinalistCount,
  loadFinalists, loadFinalistTeams, freezeFinalists, finalStandings,
};
