/* ── Audience Voting ──────────────────────────────────────────────────────── */

const dayId = new URLSearchParams(location.search).get('day');
let selectedTeamId = null;
let teams = [];
let submitting = false;

/**
 * A per-device id kept alongside the server's cookie. Two independent marks
 * mean clearing cookies alone doesn't earn a second ballot. Local storage can
 * throw outright in a locked-down browser, so nothing here may depend on it.
 */
function deviceId() {
  try {
    let id = localStorage.getItem('dj_device');
    if (!id) {
      id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now());
      localStorage.setItem('dj_device', id);
    }
    return id;
  } catch {
    return null;
  }
}

function showState(name) {
  for (const el of document.querySelectorAll('.state')) el.classList.remove('active');
  document.getElementById(`state-${name}`).classList.add('active');
}

/* ── Load ────────────────────────────────────────────────────────────────── */
async function load() {
  applyEventBranding();

  if (!dayId) {
    showClosed('That voting link is incomplete', 'Please scan the QR code again.');
    return;
  }

  const device = deviceId();
  const qs = device ? `?deviceId=${encodeURIComponent(device)}` : '';

  let data;
  try {
    data = await apiGet(`/api/vote/${encodeURIComponent(dayId)}${qs}`);
  } catch (err) {
    showClosed('Something went wrong', err.message);
    return;
  }

  if (!data.enabled) {
    showClosed('Voting is not running', 'The People’s Choice vote is switched off for this event.');
    return;
  }
  if (data.hasVoted) {
    showDone(data.votedTeamId, data.teams);
    return;
  }
  if (!data.isOpen) {
    showClosed(
      'Voting isn’t open yet',
      'Hang tight — the People’s Choice vote opens once the finalists have presented.'
    );
    return;
  }
  if (!data.teams.length) {
    showClosed('No finalists yet', 'The finalists haven’t been announced. Try again shortly.');
    return;
  }

  teams = data.teams;
  document.getElementById('vote-sub').textContent =
    `${data.day.name} — which team impressed you most?`;
  renderTeams();
  showState('vote');
}

function showClosed(title, msg) {
  document.getElementById('closed-title').textContent = title;
  document.getElementById('closed-msg').textContent   = msg;
  showState('closed');
}

function showDone(teamId, list) {
  const team = (list || teams).find(t => t.id === teamId);
  document.getElementById('done-team').textContent = team ? team.name : 'your chosen team';
  showState('done');
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function renderTeams() {
  const box = document.getElementById('team-choices');
  box.innerHTML = '';

  for (const team of teams) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'team-choice';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.innerHTML = `
      <span class="choice-dot" aria-hidden="true"></span>
      <span>${escHtml(team.name)}</span>
    `;
    btn.addEventListener('click', () => select(team, btn));
    box.appendChild(btn);
  }
}

function select(team, btn) {
  selectedTeamId = team.id;
  for (const el of document.querySelectorAll('.team-choice')) {
    el.classList.remove('selected');
    el.setAttribute('aria-checked', 'false');
  }
  btn.classList.add('selected');
  btn.setAttribute('aria-checked', 'true');

  const submit = document.getElementById('vote-submit');
  submit.disabled    = false;
  submit.textContent = `Vote for ${team.name}`;
  document.getElementById('vote-error').classList.add('hidden');
}

/* ── Submit ──────────────────────────────────────────────────────────────── */
document.getElementById('vote-submit').addEventListener('click', async () => {
  if (submitting || !selectedTeamId) return;
  submitting = true;

  const btn = document.getElementById('vote-submit');
  const err = document.getElementById('vote-error');
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Sending…';
  err.classList.add('hidden');

  try {
    await apiPost(`/api/vote/${encodeURIComponent(dayId)}`, {
      teamId:   selectedTeamId,
      deviceId: deviceId(),
    });
    showDone(selectedTeamId);
  } catch (e) {
    submitting = false;
    // "Already voted" is an outcome, not an error to retry — show the receipt.
    if (/already voted/i.test(e.message)) {
      showDone(selectedTeamId);
      return;
    }
    err.textContent = e.message;
    err.classList.remove('hidden');
    btn.disabled    = false;
    btn.textContent = 'Try again';
  }
});

document.getElementById('closed-retry').addEventListener('click', () => {
  showState('loading');
  load();
});

/* ── HTML Escape ─────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

load();
