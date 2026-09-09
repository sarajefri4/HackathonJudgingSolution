/**
 * Public audience voting — no login. A phone scans the QR code, lands here and
 * picks one finalist.
 *
 * Identity is best-effort by design: a httpOnly cookie set on first contact,
 * plus an id the page keeps in local storage. A ballot is refused if either has
 * already been used for that day, so clearing cookies alone doesn't earn a
 * second vote. It will not stop someone determined to use a private tab or a
 * second handset — that needs handed-out codes, which this event doesn't use.
 */
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');
const { loadFinalistTeams } = require('../scoring');

const VOTER_COOKIE = 'dj_voter';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Minimal cookie reader — express-session parses its own, not ours. */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Read the voter's cookie, minting and setting one if this is a first visit. */
function voterId(req, res) {
  let id = readCookie(req, VOTER_COOKIE);
  if (!id || id.length < 16 || id.length > 100) {
    id = crypto.randomUUID();
    res.cookie(VOTER_COOKIE, id, {
      maxAge:   COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  return id;
}

/** A device id from the page's local storage, if it sent a usable one. */
function deviceId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id.length >= 8 && id.length <= 100 ? id : null;
}

async function votingEnabled() {
  const row = await db.get("SELECT value FROM config WHERE key = 'voting_enabled'");
  return row?.value !== '0';
}

async function isDayOpen(dayId) {
  const row = await db.get('SELECT is_open FROM vote_state WHERE day_id = ?', [dayId]);
  return !!row?.is_open;
}

/** The ballot this voter has already cast for the day, if any. */
async function existingVote(dayId, voter, device) {
  if (device) {
    return db.get(
      'SELECT team_id FROM votes WHERE day_id = ? AND (voter_id = ? OR device_id = ?)',
      [dayId, voter, device]
    );
  }
  return db.get('SELECT team_id FROM votes WHERE day_id = ? AND voter_id = ?', [dayId, voter]);
}

/* ── GET /api/vote/:dayId ────────────────────────────────────────────────── */
router.get('/:dayId', async (req, res) => {
  const dayId  = Number(req.params.dayId);
  const voter  = voterId(req, res);
  const device = deviceId(req.query.deviceId);

  try {
    if (!await votingEnabled()) {
      return res.json({ enabled: false, isOpen: false, teams: [] });
    }

    const day = await db.get('SELECT id, name, date FROM days WHERE id = ?', [dayId]);
    if (!day) return res.status(404).json({ error: 'That voting link is not valid.' });

    const [teams, isOpen, already] = await Promise.all([
      loadFinalistTeams(dayId),
      isDayOpen(dayId),
      existingVote(dayId, voter, device),
    ]);

    res.json({
      enabled:     true,
      day,
      isOpen,
      // Names only. Tallies stay on the admin dashboard so the room can't see a
      // running total and pile onto whoever is ahead.
      teams:       teams.map(t => ({ id: t.teamId, name: t.teamName })),
      hasVoted:    !!already,
      votedTeamId: already?.team_id ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── POST /api/vote/:dayId ───────────────────────────────────────────────── */
router.post('/:dayId', async (req, res) => {
  const dayId  = Number(req.params.dayId);
  const voter  = voterId(req, res);
  const device = deviceId(req.body.deviceId);
  const teamId = Number(req.body.teamId);

  if (!teamId) return res.status(400).json({ error: 'Pick a team first.' });

  try {
    if (!await votingEnabled()) {
      return res.status(403).json({ error: 'Audience voting is switched off.' });
    }
    if (!await isDayOpen(dayId)) {
      return res.status(403).json({ error: 'Voting is closed.' });
    }

    const teams = await loadFinalistTeams(dayId);
    if (!teams.some(t => t.teamId === teamId)) {
      return res.status(400).json({ error: 'That team is not one of the finalists.' });
    }

    const already = await existingVote(dayId, voter, device);
    if (already) {
      return res.status(409).json({
        error: 'You have already voted.',
        hasVoted: true,
        votedTeamId: already.team_id,
      });
    }

    await db.run(
      'INSERT INTO votes (day_id, team_id, voter_id, device_id) VALUES (?, ?, ?, ?)',
      [dayId, teamId, voter, device]
    );

    res.json({ success: true, votedTeamId: teamId });
  } catch (err) {
    // The unique indexes are the real guard: two taps racing each other both
    // pass the check above, and one of them loses here.
    if (String(err?.message).includes('UNIQUE constraint failed')) {
      const already = await existingVote(dayId, voter, device).catch(() => null);
      return res.status(409).json({
        error: 'You have already voted.',
        hasVoted: true,
        votedTeamId: already?.team_id ?? null,
      });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
