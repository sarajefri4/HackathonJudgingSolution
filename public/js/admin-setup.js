/* ── Admin Setup Page ─────────────────────────────────────────────────────── */
(async () => {
  // Check if already authenticated
  const session = await getSession();
  if (session && session.type === 'admin') {
    showSetup();
  } else {
    document.getElementById('pin-modal').classList.remove('hidden');
  }

  // PIN Form
  document.getElementById('pin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const pin = document.getElementById('admin-pin').value.trim();
    const errEl = document.getElementById('pin-error');
    const btn = document.getElementById('pin-submit');

    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Checking…';

    try {
      await apiPost('/api/auth/admin', { pin });
      document.getElementById('pin-modal').classList.add('hidden');
      showSetup();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  });

  // Allow Enter on PIN field
  document.getElementById('admin-pin').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pin-form').requestSubmit();
  });
})();

async function showSetup() {
  document.getElementById('setup-ui').classList.remove('hidden');
  document.getElementById('save-bar').classList.remove('hidden');
  await loadConfig();
}

/* ── State ───────────────────────────────────────────────────────────────── */
let state = { days: [], teams: [], judges: [] };

async function loadConfig() {
  try {
    const data = await apiGet('/api/admin/config');
    state = data;
    renderDays();
  } catch (err) {
    showToast('Failed to load configuration: ' + err.message, 'error');
  }
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function renderDays() {
  const container = document.getElementById('days-container');
  container.innerHTML = '';

  for (const day of state.days) {
    const dayTeams  = state.teams.filter(t => t.day_id === day.id);
    const dayJudges = state.judges.filter(j => j.day_id === day.id);

    const section = document.createElement('section');
    section.className = 'day-section';
    section.dataset.dayId = day.id;
    section.innerHTML = `
      <div class="day-section-header">
        <h2 class="day-section-title">${escHtml(day.name)}</h2>
        <span class="day-section-date">${escHtml(day.date)}</span>
      </div>

      <div class="panel">
        <p class="subsection-label">Teams</p>
        <div class="item-list" id="teams-${day.id}"></div>
        <button class="btn btn-ghost btn-sm mt-12" type="button" onclick="addTeam(${day.id})">
          + Add Team
        </button>
      </div>

      <div class="panel">
        <p class="subsection-label">Judges</p>
        <div class="item-list" id="judges-${day.id}"></div>
        <button class="btn btn-ghost btn-sm mt-12" type="button" onclick="addJudge(${day.id})">
          + Add Judge
        </button>
      </div>
    `;
    container.appendChild(section);

    renderTeams(day.id, dayTeams);
    renderJudges(day.id, dayJudges);
  }
}

function renderTeams(dayId, teams) {
  const list = document.getElementById(`teams-${dayId}`);
  list.innerHTML = '';

  for (const team of teams) {
    list.appendChild(createTeamRow(dayId, team));
  }
}

function createTeamRow(dayId, team = null) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.dayId = dayId;
  if (team) row.dataset.teamId = team.id;

  row.innerHTML = `
    <input
      type="text"
      class="input"
      placeholder="Team name"
      value="${team ? escHtml(team.name) : ''}"
      aria-label="Team name"
      maxlength="80"
    >
    <button class="btn btn-ghost btn-icon" type="button" title="Remove team" aria-label="Remove team"
      onclick="removeRow(this)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  return row;
}

function renderJudges(dayId, judges) {
  const list = document.getElementById(`judges-${dayId}`);
  list.innerHTML = '';
  for (const judge of judges) {
    list.appendChild(createJudgeRow(dayId, judge));
  }
}

function createJudgeRow(dayId, judge = null) {
  const row = document.createElement('div');
  row.className = 'item-row judge-row';
  row.dataset.dayId = dayId;
  if (judge) row.dataset.judgeId = judge.id;

  const pinPlaceholder = judge?.has_pin ? 'Change PIN (leave blank to keep)' : 'Set PIN';
  const hasPinHint = judge?.has_pin ? '<span class="has-pin-badge text-sm">PIN set ✓</span>' : '';

  row.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;">
      <input
        type="text"
        class="input"
        placeholder="Judge name"
        value="${judge ? escHtml(judge.name) : ''}"
        aria-label="Judge name"
        maxlength="80"
      >
      ${hasPinHint}
    </div>
    <div class="pin-field-wrap">
      <input
        type="password"
        inputmode="numeric"
        class="input pin-input-field"
        placeholder="${escHtml(pinPlaceholder)}"
        maxlength="10"
        autocomplete="new-password"
        aria-label="${escHtml(pinPlaceholder)}"
        style="font-size:0.9rem;"
      >
      <button type="button" class="toggle-pin" title="Show/hide PIN" aria-label="Toggle PIN visibility"
        onclick="togglePinVisibility(this)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>
    <button class="btn btn-ghost btn-icon" type="button" title="Remove judge" aria-label="Remove judge"
      onclick="removeRow(this)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  return row;
}

/* ── Actions ─────────────────────────────────────────────────────────────── */
function addTeam(dayId) {
  document.getElementById(`teams-${dayId}`).appendChild(createTeamRow(dayId));
}

function addJudge(dayId) {
  document.getElementById(`judges-${dayId}`).appendChild(createJudgeRow(dayId));
}

function removeRow(btn) {
  btn.closest('.item-row').remove();
}

function togglePinVisibility(btn) {
  const input = btn.previousElementSibling;
  input.type = input.type === 'password' ? 'text' : 'password';
}

/* ── Save ────────────────────────────────────────────────────────────────── */
document.getElementById('save-btn')?.addEventListener('click', saveConfig);

async function saveConfig() {
  const btn = document.getElementById('save-btn');
  const statusEl = document.getElementById('save-status');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';
  statusEl.textContent = '';

  const days = [];

  for (const section of document.querySelectorAll('.day-section')) {
    const dayId = parseInt(section.dataset.dayId, 10);
    const teams = [];
    const judges = [];

    // Collect teams
    for (const row of section.querySelectorAll(`#teams-${dayId} .item-row`)) {
      const name  = row.querySelector('input[type="text"]').value.trim();
      const id    = row.dataset.teamId ? parseInt(row.dataset.teamId, 10) : undefined;
      if (name) teams.push({ id, name });
    }

    // Collect judges
    for (const row of section.querySelectorAll(`#judges-${dayId} .item-row`)) {
      const nameInput = row.querySelector('input[type="text"]');
      const pinInput  = row.querySelector('.pin-input-field');
      const name = nameInput?.value.trim();
      const pin  = pinInput?.value.trim();
      const id   = row.dataset.judgeId ? parseInt(row.dataset.judgeId, 10) : undefined;
      if (name) judges.push({ id, name, pin: pin || undefined });
    }

    days.push({ dayId, teams, judges });
  }

  try {
    await apiPost('/api/admin/setup', { days });
    showToast('Configuration saved successfully!');
    statusEl.textContent = 'Saved ✓';
    // Reload to get fresh IDs
    await loadConfig();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
    statusEl.textContent = 'Save failed';
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
      </svg>
      Save Configuration`;
  }
}

/* ── HTML Escape ─────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
