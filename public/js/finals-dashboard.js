/* ── People's Choice Dashboard ────────────────────────────────────────────── */
let currentDayId = null;
let data         = null;
let refreshTimer = null;
const REFRESH_INTERVAL = 15_000;   // ballots arrive fast once the vote opens

(async () => {
  applyEventBranding();

  const session = await getSession();
  if (session && session.type === 'admin') {
    document.getElementById('pin-modal').classList.add('hidden');
    init();
  } else {
    document.getElementById('pin-modal').classList.remove('hidden');
  }

  document.getElementById('pin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const pin   = document.getElementById('admin-pin').value.trim();
    const errEl = document.getElementById('pin-error');
    const btn   = e.submitter;

    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      await apiPost('/api/auth/admin', { pin });
      document.getElementById('pin-modal').classList.add('hidden');
      init();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  });
})();

/* ── Init ────────────────────────────────────────────────────────────────── */
async function init() {
  document.getElementById('dash-ui').classList.remove('hidden');

  try {
    const days = await apiGet('/api/days');
    buildDayTabs(days);
    if (days.length === 0) {
      showToast('No days configured yet — add one in Setup.', 'error');
      return;
    }
    currentDayId = days[0].id;
    activateDayTab(currentDayId);
    await load();
  } catch (err) {
    showToast('Failed to load days: ' + err.message, 'error');
  }

  document.getElementById('refresh-btn').addEventListener('click', () => load(true));
  document.getElementById('export-btn').addEventListener('click', exportCsv);
  document.getElementById('toggle-vote').addEventListener('click', toggleVote);
  document.getElementById('save-finalists').addEventListener('click', saveFinalists);
  document.getElementById('auto-finalists').addEventListener('click', autoFinalists);
  document.getElementById('save-weights').addEventListener('click', saveWeights);
  document.getElementById('clear-votes').addEventListener('click', clearVotes);
  document.getElementById('enabled-toggle').addEventListener('change', toggleEnabled);
  document.getElementById('url-select').addEventListener('change', renderQr);

  startAutoRefresh();
  // Polling a tab nobody is looking at just burns battery and DB reads.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoRefresh();
    else { startAutoRefresh(); load(); }
  });
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => load(), REFRESH_INTERVAL);
}
function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/* ── Day tabs ────────────────────────────────────────────────────────────── */
function buildDayTabs(days) {
  const bar = document.getElementById('day-tabs');
  bar.innerHTML = '';
  for (const day of days) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.type = 'button';
    tab.dataset.dayId = day.id;
    tab.setAttribute('role', 'tab');
    tab.textContent = day.name;
    tab.addEventListener('click', () => {
      currentDayId = day.id;
      activateDayTab(day.id);
      load(true);
    });
    bar.appendChild(tab);
  }
}

function activateDayTab(dayId) {
  for (const tab of document.querySelectorAll('#day-tabs .tab')) {
    const on = Number(tab.dataset.dayId) === Number(dayId);
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

/* ── Load ────────────────────────────────────────────────────────────────── */
async function load(showSpinner = false) {
  if (!currentDayId) return;
  if (showSpinner) setRefreshText('Loading…', false);

  try {
    data = await apiGet(`/api/finals/${currentDayId}`);
  } catch (err) {
    setRefreshText('Refresh failed', false);
    if (showSpinner) showToast('Failed to load: ' + err.message, 'error');
    return;
  }

  renderEnabled();
  renderFinalists();
  renderVoteControl();
  renderUrls();
  renderTally();
  renderWeights();
  renderStandings();
  setRefreshText(`Updated ${new Date().toLocaleTimeString()}`, data.isOpen);
}

function setRefreshText(text, live) {
  document.getElementById('refresh-text').textContent = text;
  document.getElementById('refresh-dot').style.background =
    live ? 'var(--accent)' : 'var(--text-dim)';
}

/* ── Master switch ───────────────────────────────────────────────────────── */
function renderEnabled() {
  document.getElementById('enabled-toggle').checked = data.votingEnabled;
  document.getElementById('disabled-banner').classList.toggle('hidden', data.votingEnabled);
  document.getElementById('finals-body').classList.toggle('hidden', !data.votingEnabled);
}

async function toggleEnabled(e) {
  const enabled = e.target.checked;
  try {
    await apiFetch('/api/finals/settings/enabled', { method: 'PUT', body: { enabled } });
    showToast(enabled ? 'Audience voting enabled' : 'Audience voting disabled — all ballots closed');
    await load();
  } catch (err) {
    e.target.checked = !enabled;
    showToast('Could not change that: ' + err.message, 'error');
  }
}

/* ── Finalists ───────────────────────────────────────────────────────────── */
function renderFinalists() {
  const list = document.getElementById('pick-list');
  const picked = new Set(data.finalists.map(f => f.teamId));
  list.innerHTML = '';

  if (data.allTeams.length === 0) {
    list.innerHTML = '<p class="text-muted text-sm">No teams on this day yet.</p>';
  }

  for (const [i, team] of data.allTeams.entries()) {
    const row = document.createElement('label');
    row.className = 'pick-row' + (picked.has(team.teamId) ? ' picked' : '');
    row.innerHTML = `
      <input type="checkbox" value="${team.teamId}" ${picked.has(team.teamId) ? 'checked' : ''}
             aria-label="${escHtml(team.teamName)}">
      <span class="pick-name">${escHtml(team.teamName)}</span>
      <span class="pick-score">${team.average === null ? 'not scored' : team.average.toFixed(1)}</span>
      <span class="pick-rank">#${i + 1}</span>
    `;
    const box = row.querySelector('input');
    box.addEventListener('change', () => {
      row.classList.toggle('picked', box.checked);
      updatePickCount();
    });
    list.appendChild(row);
  }

  const badge = document.getElementById('finalist-source');
  badge.textContent = data.isCustom ? 'chosen by you' : 'automatic';
  badge.className   = data.isCustom ? 'badge badge-accent' : 'badge badge-muted';

  document.getElementById('finalist-help').textContent = data.isCustom
    ? 'You picked these. "Use top scorers" hands the choice back to the judging scores.'
    : `Automatically the top ${data.finalistCount} by judging score. Tick or untick to override.`;

  updatePickCount();
}

function pickedIds() {
  return [...document.querySelectorAll('#pick-list input:checked')].map(el => Number(el.value));
}

function updatePickCount() {
  const n = pickedIds().length;
  document.getElementById('pick-count').textContent =
    `${n} team${n === 1 ? '' : 's'} selected`;
}

async function saveFinalists() {
  const teamIds = pickedIds();
  if (teamIds.length === 0) {
    showToast('Pick at least one finalist.', 'error');
    return;
  }
  if (data.isOpen && !confirm(
    'Voting is open. Changing the finalists now will change what phones see, and ' +
    'ballots already cast for a team you remove will stop counting.\n\nSave anyway?'
  )) return;

  try {
    await apiFetch(`/api/finals/${currentDayId}/finalists`, { method: 'PUT', body: { teamIds } });
    showToast(`${teamIds.length} finalists saved`);
    await load();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

async function autoFinalists() {
  if (!confirm(`Go back to the automatic top ${data.finalistCount} by judging score?`)) return;
  try {
    await apiFetch(`/api/finals/${currentDayId}/finalists`, { method: 'DELETE' });
    showToast('Finalists now follow the judging scores');
    await load();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

/* ── Vote control ────────────────────────────────────────────────────────── */
function renderVoteControl() {
  const lamp = document.getElementById('status-lamp');
  const text = document.getElementById('status-text');
  const btn  = document.getElementById('toggle-vote');

  lamp.classList.toggle('live', data.isOpen);
  text.textContent = data.isOpen ? 'Open — phones can vote now' : 'Closed';
  btn.textContent  = data.isOpen ? 'Close voting' : 'Open voting';
  btn.className    = data.isOpen
    ? 'btn btn-danger btn-full mb-16'
    : 'btn btn-primary btn-full mb-16';
}

async function toggleVote() {
  const open = !data.isOpen;
  if (!open && !confirm('Close voting? Phones will stop accepting ballots straight away.')) return;

  try {
    await apiPost(`/api/finals/${currentDayId}/vote-state`, { open });
    showToast(open ? 'Voting is open' : 'Voting closed');
    await load();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

/* ── QR ──────────────────────────────────────────────────────────────────── */
function renderUrls() {
  const sel = document.getElementById('url-select');
  const previous = sel.value;
  sel.innerHTML = '';

  for (const u of data.voteUrls) {
    const opt = document.createElement('option');
    opt.value = u.url;
    opt.textContent = u.label;
    sel.appendChild(opt);
  }
  // Keep the admin's choice across refreshes; otherwise prefer a real LAN
  // address over whatever host this browser used (often localhost, which is
  // useless to a phone).
  if (previous && data.voteUrls.some(u => u.url === previous)) sel.value = previous;
  else {
    const lan = data.voteUrls.find(u => !/localhost|127\.0\.0\.1/.test(u.url));
    sel.value = (lan || data.voteUrls[0])?.url || '';
  }
  renderQr();
}

async function renderQr() {
  const url = document.getElementById('url-select').value;
  const link = document.getElementById('vote-link');
  link.textContent = url;
  link.href = url;

  if (!url) return;
  try {
    const res = await fetch(`/api/finals/qr/code?url=${encodeURIComponent(url)}`,
      { credentials: 'same-origin' });
    if (!res.ok) throw new Error('QR unavailable');
    document.getElementById('qr-frame').innerHTML = await res.text();
  } catch {
    document.getElementById('qr-frame').innerHTML =
      '<p class="text-sm" style="color:#333;text-align:center;">QR unavailable</p>';
  }
}

/* ── Tally ───────────────────────────────────────────────────────────────── */
function renderTally() {
  const box = document.getElementById('tally-box');
  document.getElementById('votes-badge').textContent =
    `${data.totalVotes} ballot${data.totalVotes === 1 ? '' : 's'}`;

  if (data.standings.length === 0) {
    box.innerHTML = '<p class="text-muted text-sm">No finalists selected yet.</p>';
    return;
  }
  if (data.totalVotes === 0) {
    box.innerHTML = `<p class="text-muted text-sm">${
      data.isOpen ? 'Voting is open — no ballots yet.' : 'No ballots cast. Open voting when the finalists have presented.'
    }</p>`;
    return;
  }

  const most = Math.max(...data.standings.map(r => r.votes));
  const byVotes = [...data.standings].sort((a, b) => b.votes - a.votes);

  box.innerHTML = byVotes.map(r => `
    <div class="tally-row${r.votes === most && most > 0 ? ' leader' : ''}">
      <div class="tally-head">
        <span class="tally-name">${escHtml(r.teamName)}</span>
        <span class="tally-count">${r.votes} · ${r.audienceShare.toFixed(1)}%</span>
      </div>
      <div class="tally-track">
        <div class="tally-fill" style="width:${most > 0 ? (r.votes / most) * 100 : 0}%"></div>
      </div>
    </div>
  `).join('');
}

/* ── Weights ─────────────────────────────────────────────────────────────── */
function renderWeights() {
  const j = document.getElementById('w-judges');
  const a = document.getElementById('w-audience');
  // Don't clobber what the admin is mid-way through typing.
  if (document.activeElement !== j) j.value = data.weights.rawJudges;
  if (document.activeElement !== a) a.value = data.weights.rawAudience;

  const jp = Math.round(data.weights.judges * 100);
  document.getElementById('weights-legend').textContent =
    `${jp}% judging · ${100 - jp}% audience`;
  document.getElementById('weight-note').textContent =
    data.hasVotes ? '' : 'no ballots yet — audience share counts as 0 for every team';
}

async function saveWeights() {
  const judges   = parseFloat(document.getElementById('w-judges').value);
  const audience = parseFloat(document.getElementById('w-audience').value);
  try {
    await apiFetch('/api/finals/settings/weights', { method: 'PUT', body: { judges, audience } });
    showToast('Weights saved');
    await load();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

/* ── Standings ───────────────────────────────────────────────────────────── */
function renderStandings() {
  const table = document.getElementById('standings-table');
  if (data.standings.length === 0) {
    table.innerHTML = '<tbody><tr><td class="cell-empty">Pick the finalists to see standings.</td></tr></tbody>';
    return;
  }

  const jp = Math.round(data.weights.judges * 100);
  const ap = 100 - jp;

  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:52px;">#</th>
        <th>Team</th>
        <th class="num-cell">Judging (${jp}%)</th>
        <th class="num-cell">Votes</th>
        <th class="num-cell">Audience (${ap}%)</th>
        <th class="num-cell">Final</th>
      </tr>
    </thead>
    <tbody>
      ${data.standings.map(r => `
        <tr>
          <td class="rank-cell">${r.rank}</td>
          <td class="fw-600">${escHtml(r.teamName)}</td>
          <td class="num-cell">${r.judgeScore === null
            ? '<span class="text-dim">—</span>'
            : r.judgeScore.toFixed(1)}</td>
          <td class="num-cell">${r.votes}</td>
          <td class="num-cell">${r.audienceShare.toFixed(1)}%</td>
          <td class="num-cell final-cell">${r.finalScore.toFixed(1)}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
}

/* ── Actions ─────────────────────────────────────────────────────────────── */
function exportCsv() {
  window.location.href = `/api/finals/${currentDayId}/export`;
}

async function clearVotes() {
  if (!confirm(
    `Delete every audience ballot for ${data.day.name}?\n\n` +
    `${data.totalVotes} vote(s) will be permanently removed, and phones that ` +
    `already voted will be able to vote again.`
  )) return;

  try {
    const r = await apiFetch(`/api/finals/${currentDayId}/votes`, { method: 'DELETE' });
    showToast(`${r.cleared} ballot(s) cleared`);
    await load();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

/* ── HTML Escape ─────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
