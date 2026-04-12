/* ── Scoring Page ─────────────────────────────────────────────────────────── */
const CRITERIA = [
  { key: 'impact',      label: 'Business Impact',      weight: 0.30, desc: 'How meaningful, actionable, and relevant is the insight drawn from the data?' },
  { key: 'analysis',   label: 'Quality of Analysis',  weight: 0.25, desc: 'How effectively was the data explored and leveraged using Sigma to derive the insight?' },
  { key: 'story',      label: 'Storytelling',         weight: 0.30, desc: 'How clearly and compellingly is the insight communicated?' },
  { key: 'feasibility',label: 'Feasibility',          weight: 0.15, desc: 'Can this insight realistically be acted upon, and does the team understand its implications?' },
];

let session   = null;
let teams     = [];
let scoredMap = new Map(); // teamId → score object
let activeTeamId = null;

(async () => {
  session = await requireJudgeSession();
  if (!session) return;

  document.getElementById('header-title').textContent = session.judgeName;
  document.getElementById('header-sub').textContent   = `Day ${session.dayId === 1 ? '1 — April 20' : '2 — April 21'}`;

  document.getElementById('logout-btn').addEventListener('click', logout);

  await Promise.all([loadTeams(), loadMyScores()]);
  renderTeamTabs();

  // Activate first unscored team, or first team if all scored
  const firstUnscored = teams.find(t => !scoredMap.has(t.id));
  activateTeam((firstUnscored || teams[0])?.id);
})();

/* ── Load Data ───────────────────────────────────────────────────────────── */
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
    btn.setAttribute('aria-label', `${team.name}${scoredMap.has(team.id) ? ' (scored)' : ''}`);
    if (scoredMap.has(team.id)) btn.classList.add('scored');
    btn.addEventListener('click', () => activateTeam(team.id));
    scroll.appendChild(btn);
  }

  updateProgressPill();
}

function updateTeamTab(teamId) {
  const btn = document.querySelector(`.team-btn[data-team-id="${teamId}"]`);
  if (!btn) return;
  if (scoredMap.has(teamId)) {
    btn.classList.add('scored');
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
  const done  = scoredMap.size;
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

  const allScored = teams.length > 0 && scoredMap.size === teams.length;

  panel.innerHTML = `
    ${allScored ? `
      <div class="all-scored-banner" role="status">
        <h3>All teams scored!</h3>
        <p>You've submitted scores for every team. You can still review and update any score by selecting a team above.</p>
      </div>
    ` : ''}

    <div class="team-heading">
      <h2>${escHtml(team.name)}</h2>
      ${existing
        ? '<span class="status-pill status-done">✓ Submitted</span>'
        : '<span class="status-pill status-none">Not yet scored</span>'
      }
    </div>

    <div id="criteria-container">
      ${CRITERIA.map(c => criterionCardHTML(c, existing ? existing[c.key] : 5)).join('')}
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
  for (const c of CRITERIA) {
    const slider  = document.getElementById(`slider-${c.key}`);
    const display = document.getElementById(`val-${c.key}`);
    initSlider(slider, display);
    slider.addEventListener('input', updateTotal);
  }

  updateTotal();

  // Update submit button label
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.textContent = existing ? 'Update Score' : 'Submit Score';
  submitBtn.onclick     = submitScore;
}

function criterionCardHTML(c, value = 5) {
  const pct    = (value / 10) * 100;
  const wLabel = `${Math.round(c.weight * 100)}%`;
  return `
    <div class="criterion-card">
      <div class="criterion-header">
        <span class="criterion-name">${escHtml(c.label)}</span>
        <span class="badge badge-accent">${wLabel}</span>
      </div>
      <p class="criterion-desc">${escHtml(c.desc)}</p>
      <div class="slider-row">
        <input
          type="range"
          id="slider-${c.key}"
          min="0" max="10" step="0.5"
          value="${value}"
          aria-label="${escHtml(c.label)} score"
          aria-valuemin="0"
          aria-valuemax="10"
          aria-valuenow="${value}"
        >
        <span class="slider-value" id="val-${c.key}" aria-live="polite">${parseFloat(value).toFixed(1)}</span>
      </div>
      <div class="slider-ticks" aria-hidden="true">
        <span>0</span><span>2.5</span><span>5</span><span>7.5</span><span>10</span>
      </div>
    </div>
  `;
}

/* ── Update Total ────────────────────────────────────────────────────────── */
function updateTotal() {
  const vals = {};
  for (const c of CRITERIA) {
    vals[c.key] = parseFloat(document.getElementById(`slider-${c.key}`)?.value || 0);
    // Update aria-valuenow
    const slider = document.getElementById(`slider-${c.key}`);
    if (slider) slider.setAttribute('aria-valuenow', vals[c.key]);
  }
  const total = calcTotal(vals.impact, vals.analysis, vals.story, vals.feasibility);
  document.getElementById('total-display').textContent = total.toFixed(1);
}

/* ── Submit Score ────────────────────────────────────────────────────────── */
async function submitScore() {
  const btn   = document.getElementById('submit-btn');
  const team  = teams.find(t => t.id === activeTeamId);
  if (!team) return;

  const payload = {
    teamId:      activeTeamId,
    notes:       document.getElementById('notes-input')?.value || '',
  };
  for (const c of CRITERIA) {
    payload[c.key] = parseFloat(document.getElementById(`slider-${c.key}`)?.value || 0);
  }

  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const result = await apiPost('/api/scores', payload);
    // Update local scored map
    scoredMap.set(activeTeamId, { ...payload, total: result.total });
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
    const next = teams.find(t => !scoredMap.has(t.id) && t.id !== activeTeamId);
    if (next) {
      setTimeout(() => activateTeam(next.id), 600);
    } else if (teams.every(t => scoredMap.has(t.id))) {
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
