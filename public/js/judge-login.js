/* ── Judge Login ──────────────────────────────────────────────────────────── */
let selectedDayId   = null;
let selectedJudgeId = null;

(async () => {
  applyEventBranding();

  // If already logged in as judge, go straight to scoring
  const session = await getSession();
  if (session && session.type === 'judge') {
    window.location.href = '/score';
    return;
  }

  loadDays();

  // Navigation
  document.getElementById('back-to-day').addEventListener('click', () => goToStep('day'));
  document.getElementById('back-to-judges').addEventListener('click', () => goToStep('judge'));

  // Login form
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // PIN visibility toggle
  document.getElementById('pin-toggle').addEventListener('click', () => {
    const input = document.getElementById('judge-pin');
    input.type  = input.type === 'password' ? 'text' : 'password';
  });
})();

/* ── Step Navigation ─────────────────────────────────────────────────────── */
function goToStep(name) {
  for (const el of document.querySelectorAll('.step')) {
    el.classList.remove('active');
  }
  document.getElementById(`step-${name}`).classList.add('active');
  updateStepIndicator(name);
  // Focus first interactive element
  const first = document.getElementById(`step-${name}`).querySelector('input, button, [tabindex]');
  first?.focus();
}

function updateStepIndicator(step) {
  const steps  = ['day', 'judge', 'pin'];
  const labels = { day: 'Select your day', judge: 'Select your name', pin: 'Enter your PIN' };
  const idx    = steps.indexOf(step);

  for (let i = 0; i < 3; i++) {
    const dot = document.getElementById(`dot-${i + 1}`);
    dot.classList.remove('active', 'done');
    if (i < idx)  dot.classList.add('done');
    if (i === idx) dot.classList.add('active');
  }
  document.getElementById('step-label').textContent = labels[step] || '';
}

/* ── Load Days ───────────────────────────────────────────────────────────── */
async function loadDays() {
  const container = document.getElementById('day-cards');
  container.innerHTML = '<div class="spinner" aria-label="Loading days"></div>';

  try {
    const days = await apiGet('/api/days');
    if (days.length === 0) {
      container.innerHTML = '<p class="text-muted text-center">No days configured. Contact admin.</p>';
      return;
    }

    container.innerHTML = '';
    for (const day of days) {
      const card = document.createElement('div');
      card.className  = 'day-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${day.name}, ${day.date}`);
      card.innerHTML = `
        <div class="day-card-name">${escHtml(day.name)}</div>
        <div class="day-card-date">${escHtml(day.date)}</div>
      `;
      card.addEventListener('click', () => selectDay(day));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectDay(day); });
      container.appendChild(card);
    }
  } catch (err) {
    container.innerHTML = `<p class="text-danger text-sm">Failed to load: ${escHtml(err.message)}</p>`;
  }
}

/* ── Select Day ──────────────────────────────────────────────────────────── */
async function selectDay(day) {
  selectedDayId = day.id;

  // Highlight selected card
  for (const c of document.querySelectorAll('.day-card')) {
    c.classList.remove('selected');
  }
  event?.currentTarget?.classList.add('selected');

  document.getElementById('judges-day-label').textContent = `${day.name} — ${day.date}`;
  goToStep('judge');
  loadJudges(day.id);
}

/* ── Load Judges ─────────────────────────────────────────────────────────── */
async function loadJudges(dayId) {
  const grid = document.getElementById('judge-grid');
  grid.innerHTML = '<div class="spinner" aria-label="Loading judges"></div>';

  try {
    const judges = await apiGet(`/api/days/${dayId}/judges`);
    if (judges.length === 0) {
      grid.innerHTML = '<p class="text-muted text-center">No judges configured for this day. Contact admin.</p>';
      return;
    }

    grid.innerHTML = '';
    for (const judge of judges) {
      const card = document.createElement('div');
      card.className  = 'judge-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', judge.name);
      card.innerHTML  = `<span class="judge-card-name">${escHtml(judge.name)}</span>`;
      card.addEventListener('click', () => selectJudge(judge, card));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectJudge(judge, card); });
      grid.appendChild(card);
    }
  } catch (err) {
    grid.innerHTML = `<p class="text-danger text-sm">Failed to load: ${escHtml(err.message)}</p>`;
  }
}

/* ── Select Judge ────────────────────────────────────────────────────────── */
function selectJudge(judge, cardEl) {
  selectedJudgeId = judge.id;

  for (const c of document.querySelectorAll('.judge-card')) {
    c.classList.remove('selected');
    c.setAttribute('aria-pressed', 'false');
  }
  cardEl.classList.add('selected');
  cardEl.setAttribute('aria-pressed', 'true');

  document.getElementById('selected-name').textContent = judge.name;
  document.getElementById('judge-pin').value = '';
  document.getElementById('login-error').classList.add('hidden');
  goToStep('pin');
}

/* ── Login ───────────────────────────────────────────────────────────────── */
async function handleLogin(e) {
  e.preventDefault();
  const pin    = document.getElementById('judge-pin').value.trim();
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('login-submit');

  if (!selectedJudgeId) {
    errEl.textContent = 'Please select your name first.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!pin) {
    errEl.textContent = 'Please enter your PIN.';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  btn.disabled    = true;
  btn.innerHTML   = '<span class="spinner"></span> Signing in…';

  try {
    await apiPost('/api/auth/judge', { judgeId: selectedJudgeId, pin });
    window.location.href = '/score';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    document.getElementById('judge-pin').value = '';
    document.getElementById('judge-pin').focus();
  } finally {
    btn.disabled  = false;
    btn.textContent = 'Sign In';
  }
}

/* ── HTML Escape ─────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
