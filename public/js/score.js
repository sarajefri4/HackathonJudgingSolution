/* ── Scoring Page ─────────────────────────────────────────────────────────── */
let session   = null;
let criteria  = [];        // rubric, loaded from the server
let teams     = [];
let scoredMap = new Map(); // teamId → score object
let activeTeamId = null;

(async () => {
  applyEventBranding();

  session = await requireJudgeSession();
  if (!session) return;

  document.getElementById('header-title').textContent = session.judgeName;
  document.getElementById('logout-btn').addEventListener('click', logout);

  await Promise.all([loadDayLabel(), loadCriteria(), loadTeams(), loadMyScores()]);

  if (criteria.length === 0) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('submit-bar').classList.add('hidden');
    document.getElementById('team-panel').classList.remove('hidden');
    document.getElementById('team-panel').innerHTML =
      '<div class="empty-state"><p>No judging criteria have been set up yet. Please contact the admin.</p></div>';
    return;
  }

  renderTeamTabs();

  // Activate first unscored team, or first team if all scored
  const firstUnscored = teams.find(t => !scoredMap.has(t.id));
  activateTeam((firstUnscored || teams[0])?.id);
})();

/* ── Load Data ───────────────────────────────────────────────────────────── */
async function loadDayLabel() {
  try {
    const days = await apiGet('/api/days');
    const day  = days.find(d => d.id === session.dayId);
    document.getElementById('header-sub').textContent =
      day ? [day.name, day.date].filter(Boolean).join(' — ') : '';
  } catch {
    document.getElementById('header-sub').textContent = '';
  }
}

async function loadCriteria() {
  criteria = await apiGet('/api/criteria');
}

async function loadTeams() {
  teams = await apiGet(`/api/days/${session.dayId}/teams`);
}

async function loadMyScores() {
  const scores = await apiGet('/api/scores/my-scores');
  scoredMap.clear();
  for (const s of scores) {
    scoredMap.set(s.team_id, s);
  }
}

/* ── Score Completeness ──────────────────────────────────────────────────
   A criterion added after a judge submitted has no recorded value on that
   score — it counts as 0 until the judge scores the team again, so flag it
   rather than letting it quietly drag the team's total down. */
function isComplete(score) {
  if (!score) return false;
  return criteria.every(c => score.values?.[c.id] !== undefined);
}

function isStale(score) {
  return !!score && !isComplete(score);
}

/* ── Team Tabs ───────────────────────────────────────────────────────────── */
function renderTeamTabs() {
  const scroll = document.getElementById('teams-scroll');
  scroll.innerHTML = '';

  for (const team of teams) {
    const btn = document.createElement('button');
    btn.className = 'team-btn';
    btn.textContent = team.name;
    btn.dataset.teamId = team.id;
    btn.setAttribute('type', 'button');
    const score = scoredMap.get(team.id);
    btn.setAttribute('aria-label',
      `${team.name}${isComplete(score) ? ' (scored)' : isStale(score) ? ' (needs re-scoring)' : ''}`);
    if (isComplete(score))    btn.classList.add('scored');
    else if (isStale(score))  btn.classList.add('stale');
    btn.addEventListener('click', () => activateTeam(team.id));
    scroll.appendChild(btn);
  }

  updateProgressPill();
}

function updateTeamTab(teamId) {
  const btn = document.querySelector(`.team-btn[data-team-id="${teamId}"]`);
  if (!btn) return;
  const score = scoredMap.get(teamId);
  btn.classList.toggle('scored', isComplete(score));
  btn.classList.toggle('stale',  isStale(score));
  if (isComplete(score)) {
    btn.setAttribute('aria-label', `${teams.find(t => t.id === teamId)?.name} (scored)`);
  }
}

function setActiveTab(teamId) {
  for (const btn of document.querySelectorAll('.team-btn')) {
    btn.classList.remove('active');
    btn.removeAttribute('aria-current');
  }
  const active = document.querySelector(`.team-btn[data-team-id="${teamId}"]`);
  if (active) {
    active.classList.add('active');
    active.setAttribute('aria-current', 'true');
    // Scroll into view
    active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
}

function updateProgressPill() {
  const total = teams.length;
  const done  = teams.filter(t => isComplete(scoredMap.get(t.id))).length;
  document.getElementById('progress-pill').textContent = `${done}/${total} scored`;
}

/* ── Activate Team ───────────────────────────────────────────────────────── */
function activateTeam(teamId) {
  if (!teamId || !teams.find(t => t.id === teamId)) return;
  activeTeamId = teamId;
  setActiveTab(teamId);
  renderScoringPanel(teamId);
}

/* ── Scoring Panel ───────────────────────────────────────────────────────── */
function renderScoringPanel(teamId) {
  const team      = teams.find(t => t.id === teamId);
  const existing  = scoredMap.get(teamId) || null;
  const loading   = document.getElementById('loading-state');
  const panel     = document.getElementById('team-panel');

  loading.classList.add('hidden');
  panel.classList.remove('hidden');

  const allScored = teams.length > 0 && teams.every(t => isComplete(scoredMap.get(t.id)));
  const stale     = isStale(existing);
  const weightSum = criteria.reduce((s, c) => s + c.weight, 0) || 1;

  panel.innerHTML = `
    ${allScored ? `
      <div class="all-scored-banner" role="status">
        <h3>All teams scored!</h3>
        <p>You've submitted scores for every team. You can still review and update any score by selecting a team above.</p>
      </div>
    ` : ''}

    <div class="team-heading">
      <h2>${escHtml(team.name)}</h2>
      ${stale
        ? '<span class="status-pill status-pending">Needs re-scoring</span>'
        : existing
          ? '<span class="status-pill status-done">✓ Submitted</span>'
          : '<span class="status-pill status-none">Not yet scored</span>'
      }
    </div>

    ${stale ? `
      <div class="stale-note" role="status">
        The rubric changed since you scored this team. Set the criteria below and submit again
        so this team's total counts in full.
      </div>
    ` : ''}

    <div id="criteria-container">
      ${criteria.map(c => {
        // A criterion added after this score was submitted has no stored value.
        const saved = existing?.values?.[c.id];
        const value = saved !== undefined ? saved : c.max_score / 2;
        return criterionCardHTML(c, value, weightSum);
      }).join('')}
    </div>

    <div class="notes-section">
      <label for="notes-input">Notes <span class="text-muted text-sm">(optional)</span></label>
      <textarea
        id="notes-input"
        class="input"
        placeholder="Optional comments about this team's presentation…"
        rows="3"
        maxlength="1000"
      >${escHtml(existing?.notes || '')}</textarea>
    </div>
  `;

  // Wire up sliders
  for (const c of criteria) {
    const slider  = document.getElementById(`slider-${c.id}`);
    const display = document.getElementById(`val-${c.id}`);
    initSlider(slider, display);
    slider.addEventListener('input', updateTotal);
  }

  updateTotal();

  // Update submit button label
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.textContent = existing ? 'Update Score' : 'Submit Score';
  submitBtn.onclick     = submitScore;
}

function criterionCardHTML(c, value, weightSum) {
  const max    = c.max_score;
  const wLabel = `${Math.round(c.weight / weightSum * 100)}%`;
  // Step finely enough to be useful on small scales, in halves on larger ones.
  const step   = max <= 5 ? 0.25 : 0.5;
  const ticks  = [0, 0.25, 0.5, 0.75, 1].map(f => trimNum(max * f));

  return `
    <div class="criterion-card">
      <div class="criterion-header">
        <span class="criterion-name">${escHtml(c.label)}</span>
        <span class="badge badge-accent">${wLabel}</span>
      </div>
      ${c.description ? `<p class="criterion-desc">${escHtml(c.description)}</p>` : ''}
      <div class="slider-row">
        <input
          type="range"
          id="slider-${c.id}"
          min="0" max="${max}" step="${step}"
          value="${value}"
          aria-label="${escHtml(c.label)} score"
          aria-valuemin="0"
          aria-valuemax="${max}"
          aria-valuenow="${value}"
        >
        <span class="slider-value" id="val-${c.id}" aria-live="polite">${parseFloat(value).toFixed(1)}</span>
      </div>
      <div class="slider-ticks" aria-hidden="true">
        ${ticks.map(t => `<span>${t}</span>`).join('')}
      </div>
    </div>
  `;
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
}

/* ── Update Total ────────────────────────────────────────────────────────── */
function currentValues() {
  const values = {};
  for (const c of criteria) {
    const slider = document.getElementById(`slider-${c.id}`);
    const v = parseFloat(slider?.value || 0);
    values[c.id] = v;
    if (slider) slider.setAttribute('aria-valuenow', v);
  }
  return values;
}

function updateTotal() {
  const total = calcTotal(criteria, currentValues());
  document.getElementById('total-display').textContent = total.toFixed(1);
}

/* ── Submit Score ────────────────────────────────────────────────────────── */
async function submitScore() {
  const btn   = document.getElementById('submit-btn');
  const team  = teams.find(t => t.id === activeTeamId);
  if (!team) return;

  const values = currentValues();
  const payload = {
    teamId: activeTeamId,
    notes:  document.getElementById('notes-input')?.value || '',
    values,
  };

  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const result = await apiPost('/api/scores', payload);
    // Update local scored map
    // Keys come back from the inputs as strings; normalise so isComplete() matches.
    const savedValues = {};
    for (const c of criteria) savedValues[c.id] = values[c.id];
    scoredMap.set(activeTeamId, { ...payload, values: savedValues, total: result.total });
    updateTeamTab(activeTeamId);
    updateProgressPill();

    // Update the panel heading status
    const pill = document.querySelector('.team-heading .status-pill');
    if (pill) {
      pill.className = 'status-pill status-done';
      pill.textContent = '✓ Submitted';
    }

    showToast(`Score saved! ${team.name}: ${result.total.toFixed(1)}/100`);
    btn.textContent = 'Update Score';

    // Auto-advance to next unscored team
    const next = teams.find(t => !isComplete(scoredMap.get(t.id)) && t.id !== activeTeamId);
    if (next) {
      setTimeout(() => activateTeam(next.id), 600);
    } else if (teams.every(t => isComplete(scoredMap.get(t.id)))) {
      // All done - re-render to show banner
      setTimeout(() => renderScoringPanel(activeTeamId), 600);
    }
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ── Logout ──────────────────────────────────────────────────────────────── */
async function logout() {
  try {
    await apiPost('/api/auth/logout', {});
  } finally {
    window.location.href = '/';
  }
}

/* ── HTML Escape ─────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
