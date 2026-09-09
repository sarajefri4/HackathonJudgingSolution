/**
 * Admin side of the People's Choice round: who the finalists are, whether the
 * audience vote is open, the QR code that points phones at it, and the combined
 * standings once ballots start arriving.
 */
const express = require('express');
const os      = require('os');
const QRCode  = require('qrcode');
const router  = express.Router();
const db      = require('../db');
const requireAdmin = require('../require-admin');
const {
  teamJudgeAverages, rankByJudging, loadWeights,
  loadFinalistCount, loadFinalists, freezeFinalists, finalStandings,
} = require('../scoring');

router.use(requireAdmin);

/** Every LAN address a phone on the venue WiFi could reach this server on. */
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ label: name, address: a.address });
    }
  }
  return out;
}

async function isVoteOpen(dayId) {
  const row = await db.get('SELECT is_open FROM vote_state WHERE day_id = ?', [dayId]);
  return !!row?.is_open;
}

/* ── GET /api/finals/:dayId ──────────────────────────────────────────────── */
router.get('/:dayId', async (req, res) => {
  const dayId = Number(req.params.dayId);

  try {
    const day = await db.get('SELECT * FROM days WHERE id = ?', [dayId]);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    const [averages, finalists, standings, open, finalistCount] = await Promise.all([
      teamJudgeAverages(dayId),
      loadFinalists(dayId),
      finalStandings(dayId),
      isVoteOpen(dayId),
      loadFinalistCount(),
    ]);

    // A QR pointing at "localhost" is useless to a phone, so offer the machine's
    // real LAN addresses alongside whatever host the admin happens to be using.
    const port      = req.socket.localPort || process.env.PORT || 3000;
    const candidates = lanAddresses().map(a => ({
      label: `${a.address} (${a.label})`,
      url:   `http://${a.address}:${port}/vote?day=${dayId}`,
    }));
    const hostUrl = `${req.protocol}://${req.get('host')}/vote?day=${dayId}`;
    if (!candidates.some(c => c.url === hostUrl)) {
      candidates.push({ label: `${req.get('host')} (this browser)`, url: hostUrl });
    }

    const enabledRow = await db.get("SELECT value FROM config WHERE key = 'voting_enabled'");

    res.json({
      day,
      votingEnabled: enabledRow?.value !== '0',
      isOpen:        open,
      finalistCount,
      isCustom:      finalists.isCustom,
      finalists:     finalists.teams,
      autoTop:       rankByJudging(averages).slice(0, finalistCount),
      allTeams:      rankByJudging(averages),
      standings:     standings.rows,
      totalVotes:    standings.totalVotes,
      hasVotes:      standings.hasVotes,
      weights:       await loadWeights(),
      voteUrls:      candidates,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── PUT /api/finals/:dayId/finalists — explicit override ────────────────── */
router.put('/:dayId/finalists', async (req, res) => {
  const dayId = Number(req.params.dayId);
  const { teamIds } = req.body;

  if (!Array.isArray(teamIds)) {
    return res.status(400).json({ error: 'Expected { teamIds: [...] }' });
  }
  if (teamIds.length === 0) {
    return res.status(400).json({ error: 'Pick at least one finalist' });
  }

  try {
    const ids = [...new Set(teamIds.map(Number))];
    const ph  = ids.map(() => '?').join(',');
    const valid = await db.all(
      `SELECT id FROM teams WHERE day_id = ? AND id IN (${ph})`, [dayId, ...ids]
    );
    if (valid.length !== ids.length) {
      return res.status(400).json({ error: 'One or more teams are not part of this day' });
    }

    await db.transaction(async () => {
      await db.run('DELETE FROM finalists WHERE day_id = ?', [dayId]);
      for (const [i, teamId] of ids.entries()) {
        await db.run(
          'INSERT INTO finalists (day_id, team_id, position) VALUES (?, ?, ?)',
          [dayId, teamId, i]
        );
      }
    });

    res.json({ success: true, count: ids.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── DELETE /api/finals/:dayId/finalists — back to automatic ─────────────── */
router.delete('/:dayId/finalists', async (req, res) => {
  try {
    await db.run('DELETE FROM finalists WHERE day_id = ?', [Number(req.params.dayId)]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── POST /api/finals/:dayId/vote-state — open or close the vote ─────────── */
router.post('/:dayId/vote-state', async (req, res) => {
  const dayId = Number(req.params.dayId);
  const open  = !!req.body.open;

  try {
    const day = await db.get('SELECT id FROM days WHERE id = ?', [dayId]);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    if (open) {
      const { teams } = await loadFinalists(dayId);
      if (teams.length === 0) {
        return res.status(400).json({ error: 'Choose the finalists before opening the vote' });
      }
      // Lock the line-up in so a late judging score can't reshuffle it mid-vote.
      await freezeFinalists(dayId);
    }

    await db.run(
      `INSERT INTO vote_state (day_id, is_open) VALUES (?, ?)
       ON CONFLICT(day_id) DO UPDATE SET is_open = excluded.is_open`,
      [dayId, open ? 1 : 0]
    );
    res.json({ success: true, isOpen: open });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── PUT /api/finals/weights ─────────────────────────────────────────────── */
router.put('/settings/weights', async (req, res) => {
  const judges   = parseFloat(req.body.judges);
  const audience = parseFloat(req.body.audience);

  if (!isFinite(judges) || !isFinite(audience) || judges < 0 || audience < 0) {
    return res.status(400).json({ error: 'Both weights must be numbers of 0 or more' });
  }
  if (judges + audience <= 0) {
    return res.status(400).json({ error: 'The two weights cannot both be zero' });
  }

  try {
    await db.transaction(async () => {
      for (const [key, value] of [['weight_judges', judges], ['weight_audience', audience]]) {
        await db.run(
          `INSERT INTO config (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, String(value)]
        );
      }
    });
    res.json({ success: true, weights: await loadWeights() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── PUT /api/finals/settings/finalist-count ─────────────────────────────── */
router.put('/settings/finalist-count', async (req, res) => {
  const n = parseInt(req.body.count, 10);
  if (!isFinite(n) || n < 1 || n > 50) {
    return res.status(400).json({ error: 'Finalist count must be between 1 and 50' });
  }
  try {
    await db.run(
      `INSERT INTO config (key, value) VALUES ('finalist_count', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(n)]
    );
    res.json({ success: true, count: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── PUT /api/finals/settings/enabled — master switch ────────────────────── */
router.put('/settings/enabled', async (req, res) => {
  const enabled = !!req.body.enabled;
  try {
    await db.run(
      `INSERT INTO config (key, value) VALUES ('voting_enabled', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [enabled ? '1' : '0']
    );
    // Switching the feature off also closes every day's ballot, so turning it
    // back on can't silently resume a vote nobody expects to be live.
    if (!enabled) await db.run('UPDATE vote_state SET is_open = 0');
    res.json({ success: true, enabled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── DELETE /api/finals/:dayId/votes — clear ballots ─────────────────────── */
router.delete('/:dayId/votes', async (req, res) => {
  try {
    const { changes } = await db.run('DELETE FROM votes WHERE day_id = ?', [Number(req.params.dayId)]);
    res.json({ success: true, cleared: changes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── GET /api/finals/qr/code?url=… — QR as SVG ───────────────────────────── */
router.get('/qr/code', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\/[^\s]+$/i.test(url)) {
    return res.status(400).json({ error: 'A http(s) URL is required' });
  }

  try {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      color: { dark: '#0b1f18', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate QR code' });
  }
});

/* ── GET /api/finals/:dayId/export — combined standings as CSV ───────────── */
router.get('/:dayId/export', async (req, res) => {
  const dayId = Number(req.params.dayId);

  try {
    const day = await db.get('SELECT * FROM days WHERE id = ?', [dayId]);
    if (!day) return res.status(404).json({ error: 'Day not found' });

    const { rows, totalVotes, weights } = await finalStandings(dayId);
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const header = [
      'Rank', 'Team',
      `Judging Score (${Math.round(weights.judges * 100)}%)`,
      'Judges Scored',
      'Audience Votes',
      `Audience Share % (${Math.round(weights.audience * 100)}%)`,
      'Final Score',
    ];
    const lines = [
      header.join(','),
      ...rows.map(r => [
        r.rank, escape(r.teamName),
        r.judgeScore === null ? '' : r.judgeScore.toFixed(2),
        r.scoreCount, r.votes, r.audienceShare.toFixed(2), r.finalScore.toFixed(2),
      ].join(',')),
      '',
      `${escape('Total ballots cast')},${totalVotes}`,
    ];

    const filename = `${day.name.toLowerCase().replace(/\s+/g, '-')}-final-standings.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
