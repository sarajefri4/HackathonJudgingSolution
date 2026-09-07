/* ── Admin Setup Page ─────────────────────────────────────────────────────── */
(async () => {
  applyEventBranding();

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
let state = { event: {}, days: [], teams: [], judges: [], criteria: [] };

// Client-side ids for rows the admin adds before saving.
let tempIdSeq = 0;
const nextTempId = () => `new-${++tempIdSeq}`;

async function loadConfig() {
  try {
    state = await apiGet('/api/admin/config');
    renderEvent();
    renderCriteria();
    renderDays();
  } catch (err) {
    showToast('Failed to load configuration: ' + err.message, 'error');
  }
}

/* ── Event Branding ──────────────────────────────────────────────────────── */
function renderEvent() {
  document.getElementById('event-name').value    = state.event?.event_name    || '';
  document.getElementById('event-tagline').value = state.event?.event_tagline || '';
}

/* ── Criteria ────────────────────────────────────────────────────────────── */
function renderCriteria() {
  const list = document.getElementById('criteria-list');
  list.innerHTML = '';
  for (const c of state.criteria) list.appendChild(createCriterionRow(c));
  updateWeightSummary();
}

function createCriterionRow(criterion = null) {
  const row = document.createElement('div');
  row.className = 'criterion-edit';
  if (criterion?.id) row.dataset.criterionId = criterion.id;

  row.innerHTML = `
    <div class="criterion-edit-main">
      <div class="criterion-edit-head">
        <input
          type="text"
          class="input crit-label"
          placeholder="Criterion name (e.g. Business Impact)"
          value="${criterion ? escHtml(criterion.label) : ''}"
          aria-label="Criterion name"
          maxlength="80"
        >
        <div class="crit-num">
          <label class="crit-num-label">Weight</label>
          <div class="crit-num-field">
            <input
              type="number"
              class="input crit-weight"
              value="${criterion ? criterion.weight : 25}"
              min="0.1" step="1"
              aria-label="Weight"
            >
            <span class="crit-suffix">%</span>
          </div>
        </div>
        <div class="crit-num">
          <label class="crit-num-label">Max rating</label>
          <div class="crit-num-field">
            <input
              type="number"
              class="input crit-max"
              value="${criterion ? criterion.max_score : 10}"
              min="1" step="1"
              aria-label="Max rating"
            >
          </div>
        </div>
      </div>
      <input
        type="text"
        class="input crit-desc"
        placeholder="Description shown to judges (optional)"
        value="${criterion ? escHtml(criterion.description || '') : ''}"
        aria-label="Criterion description"
        maxlength="300"
      >
    </div>
    <div class="criterion-edit-actions">
      <button class="btn btn-ghost btn-icon" type="button" title="Move up" aria-label="Move criterion up"
        onclick="moveCriterion(this,-1)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button class="btn btn-ghost btn-icon" type="button" title="Move down" aria-label="Move criterion down"
        onclick="moveCriterion(this,1)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button class="btn btn-ghost btn-icon" type="button" title="Remove criterion" aria-label="Remove criterion"
        onclick="removeCriterion(this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;

  row.querySelector('.crit-weight').addEventListener('input', updateWeightSummary);
  return row;
}

function addCriterion() {
  const list = document.getElementById('criteria-list');
  const row  = createCriterionRow();
  list.appendChild(row);
  row.querySelector('.crit-label').focus();
  updateWeightSummary();
}

function removeCriterion(btn) {
  const row = btn.closest('.criterion-edit');
  const id  = row.dataset.criterionId;
  const label = row.querySelector('.crit-label').value.trim() || 'this criterion';

  // Deleting a saved criterion throws away scores already recorded against it.
  if (id && !confirm(`Remove "${label}"?\n\nAny scores judges already gave for it will be deleted and every total recalculated.`)) {
    return;
  }
  row.remove();
  updateWeightSummary();
}

function moveCriterion(btn, dir) {
  const row  = btn.closest('.criterion-edit');
  const sib  = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sib) return;
  if (dir < 0) row.parentNode.insertBefore(row, sib);
  else         row.parentNode.insertBefore(sib, row);
}

function updateWeightSummary() {
  const rows = [...document.querySelectorAll('.criterion-edit')];
  const sum  = rows.reduce((s, r) => s + (parseFloat(r.querySelector('.crit-weight').value) || 0), 0);
  const el   = document.getElementById('weight-summary');
  if (!el) return;

  const rounded = Math.round(sum * 100) / 100;
  if (rows.length === 0) {
    el.textContent = 'Add at least one criterion.';
    el.className = 'weight-summary warn';
  } else if (Math.abs(rounded - 100) < 0.01) {
    el.textContent = `Weights total ${rounded}% ✓`;
    el.className = 'weight-summary ok';
  } else {
    el.textContent = `Weights total ${rounded}% — they don't add to 100, so they'll be scaled proportionally.`;
    el.className = 'weight-summary warn';
  }
}

/* ── Days ────────────────────────────────────────────────────────────────── */
function renderDays() {
  const container = document.getElementById('days-container');
  container.innerHTML = '';
  for (const day of state.days) {
    container.appendChild(createDaySection(day));
  }
  updateDayEmptyState();
}

function createDaySection(day = null) {
  // Unsaved days get a temporary key so their team/judge lists stay addressable.
  const key = day ? `d${day.id}` : nextTempId();

  const section = document.createElement('section');
  section.className = 'day-section';
  if (day) section.dataset.dayId = day.id;
  section.dataset.key = key;

  section.innerHTML = `
    <div class="day-section-header">
      <input
        type="text"
        class="input day-name-input"
        placeholder="Day name (e.g. Day 3)"
        value="${day ? escHtml(day.name) : ''}"
        aria-label="Day name"
        maxlength="60"
      >
      <input
        type="text"
        class="input day-date-input"
        placeholder="Date (e.g. April 22)"
        value="${day ? escHtml(day.date) : ''}"
        aria-label="Day date"
        maxlength="60"
      >
      <button class="btn btn-ghost btn-icon" type="button" title="Remove day" aria-label="Remove day"
        onclick="removeDay(this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="panel">
      <p class="subsection-label">Teams</p>
      <div class="item-list" data-list="teams"></div>
      <button class="btn btn-ghost btn-sm mt-12" type="button" onclick="addTeam(this)">
        + Add Team
      </button>
    </div>

    <div class="panel">
      <p class="subsection-label">Judges</p>
      <div class="item-list" data-list="judges"></div>
      <button class="btn btn-ghost btn-sm mt-12" type="button" onclick="addJudge(this)">
        + Add Judge
      </button>
    </div>
  `;

  const teamList  = section.querySelector('[data-list="teams"]');
  const judgeList = section.querySelector('[data-list="judges"]');

  if (day) {
    for (const t of state.teams.filter(t => t.day_id === day.id))  teamList.appendChild(createTeamRow(t));
    for (const j of state.judges.filter(j => j.day_id === day.id)) judgeList.appendChild(createJudgeRow(j));
  }

  return section;
}

function addDay() {
  const container = document.getElementById('days-container');
  const section = createDaySection();
  container.appendChild(section);
  updateDayEmptyState();
  section.querySelector('.day-name-input').focus();
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function removeDay(btn) {
  const section = btn.closest('.day-section');
  const name    = section.querySelector('.day-name-input').value.trim() || 'this day';

  // Removing a saved day cascades to its teams, judges and their scores.
  if (section.dataset.dayId &&
      !confirm(`Remove "${name}"?\n\nIts teams, judges and all their submitted scores will be deleted.`)) {
    return;
  }
  section.remove();
  updateDayEmptyState();
}

function updateDayEmptyState() {
  const empty = document.getElementById('days-empty');
  const count = document.querySelectorAll('.day-section').length;
  empty.classList.toggle('hidden', count > 0);
}

/* ── Team / Judge rows ───────────────────────────────────────────────────── */
function createTeamRow(team = null) {
  const row = document.createElement('div');
  row.className = 'item-row';
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

function createJudgeRow(judge = null) {
  const row = document.createElement('div');
  row.className = 'item-row judge-row';
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
function addTeam(btn) {
  const list = btn.closest('.panel').querySelector('[data-list="teams"]');
  const row  = createTeamRow();
  list.appendChild(row);
  row.querySelector('input').focus();
}

function addJudge(btn) {
  const list = btn.closest('.panel').querySelector('[data-list="judges"]');
  const row  = createJudgeRow();
  list.appendChild(row);
  row.querySelector('input').focus();
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
document.getElementById('add-day-btn')?.addEventListener('click', addDay);
document.getElementById('add-criterion-btn')?.addEventListener('click', addCriterion);

function collectPayload() {
  const event = {
    event_name:    document.getElementById('event-name').value.trim(),
    event_tagline: document.getElementById('event-tagline').value.trim(),
  };

  const days = [];
  for (const section of document.querySelectorAll('.day-section')) {
    const id   = section.dataset.dayId ? parseInt(section.dataset.dayId, 10) : undefined;
    const name = section.querySelector('.day-name-input').value.trim();
    const date = section.querySelector('.day-date-input').value.trim();
    if (!name) continue;

    const teams = [];
    for (const row of section.querySelectorAll('[data-list="teams"] .item-row')) {
      const teamName = row.querySelector('input[type="text"]').value.trim();
      const teamId   = row.dataset.teamId ? parseInt(row.dataset.teamId, 10) : undefined;
      if (teamName) teams.push({ id: teamId, name: teamName });
    }

    const judges = [];
    for (const row of section.querySelectorAll('[data-list="judges"] .item-row')) {
      const judgeName = row.querySelector('input[type="text"]')?.value.trim();
      const pin       = row.querySelector('.pin-input-field')?.value.trim();
      const judgeId   = row.dataset.judgeId ? parseInt(row.dataset.judgeId, 10) : undefined;
      if (judgeName) judges.push({ id: judgeId, name: judgeName, pin: pin || undefined });
    }

    days.push({ id, name, date, teams, judges });
  }

  const criteria = [];
  for (const row of document.querySelectorAll('.criterion-edit')) {
    const label = row.querySelector('.crit-label').value.trim();
    if (!label) continue;
    criteria.push({
      id:          row.dataset.criterionId ? parseInt(row.dataset.criterionId, 10) : undefined,
      label,
      description: row.querySelector('.crit-desc').value.trim(),
      weight:      parseFloat(row.querySelector('.crit-weight').value),
      maxScore:    parseFloat(row.querySelector('.crit-max').value),
    });
  }

  return { event, days, criteria };
}

async function saveConfig() {
  const btn = document.getElementById('save-btn');
  const statusEl = document.getElementById('save-status');
  const payload = collectPayload();

  // Validate before hitting the server so the admin gets a pointed message.
  if (payload.criteria.length === 0) {
    showToast('Add at least one judging criterion before saving.', 'error');
    return;
  }
  for (const c of payload.criteria) {
    if (!isFinite(c.weight) || c.weight <= 0) {
      showToast(`Weight for "${c.label}" must be greater than 0.`, 'error');
      return;
    }
    if (!isFinite(c.maxScore) || c.maxScore <= 0) {
      showToast(`Max rating for "${c.label}" must be greater than 0.`, 'error');
      return;
    }
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';
  statusEl.textContent = '';

  try {
    await apiPost('/api/admin/setup', payload);
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
