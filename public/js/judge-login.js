/* ── Judge Login ──────────────────────────────────────────────────────────── */
let signingIn = false;

(async () => {
  applyEventBranding();

  // If already signed in as a judge, go straight to scoring
  const session = await getSession();
  if (session && session.type === 'judge') {
    window.location.href = '/score';
    return;
  }

  loadDays();
  document.getElementById('back-to-day').addEventListener('click', () => goToStep('day'));
})();

/* ── Step Navigation ─────────────────────────────────────────────────────── */
function goToStep(name) {
  for (const el of document.querySelectorAll('.step')) el.classList.remove('active');

  const step = document.getElementById(`step-${name}`);
  step.classList.add('active');
  updateStepIndicator(name);

  // Focus the step container, not the first control inside it. Focusing the
  // "← Back" button meant the tail of the very interaction that advanced the
  // step — a Space keyup, or a touch's delayed click landing where Back had
  // just been drawn — activated Back and threw the judge back to day selection.
  step.focus({ preventScroll: true });
}

function updateStepIndicator(step) {
  const steps  = ['day', 'judge'];
  const labels = { day: 'Select your day', judge: 'Select your name' };
  const idx    = steps.indexOf(step);

  for (let i = 0; i < steps.length; i++) {
    const dot = document.getElementById(`dot-${i + 1}`);
    if (!dot) continue;
    dot.classList.remove('active', 'done');
    if (i < idx)   dot.classList.add('done');
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
      card.className = 'day-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${day.name}, ${day.date}`);
      card.innerHTML = `
        <div class="day-card-name">${escHtml(day.name)}</div>
        <div class="day-card-date">${escHtml(day.date)}</div>
      `;
      card.addEventListener('click', () => selectDay(day, card));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();   // stop the keyup re-firing on whatever gains focus
          selectDay(day, card);
        }
      });
      container.appendChild(card);
    }
  } catch (err) {
    container.innerHTML = `<p class="text-danger text-sm">Failed to load: ${escHtml(err.message)}</p>`;
  }
}

/* ── Select Day ──────────────────────────────────────────────────────────── */
function selectDay(day, cardEl) {
  for (const c of document.querySelectorAll('.day-card')) c.classList.remove('selected');
  cardEl?.classList.add('selected');

  document.getElementById('judges-day-label').textContent = `${day.name} — ${day.date}`;
  hideError();
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
      card.className = 'judge-card';
      card.dataset.dayId = dayId;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', judge.name);
      card.innerHTML = `<span class="judge-card-name">${escHtml(judge.name)}</span>`;
      card.addEventListener('click', () => signIn(judge, card, dayId));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          signIn(judge, card, dayId);
        }
      });
      grid.appendChild(card);
    }
  } catch (err) {
    grid.innerHTML = `<p class="text-danger text-sm">Failed to load: ${escHtml(err.message)}</p>`;
  }
}

/* ── Sign In ─────────────────────────────────────────────────────────────────
   Picking a name is the whole login — there is no PIN step. */
async function signIn(judge, cardEl, dayId) {
  if (signingIn) return;
  signingIn = true;

  for (const c of document.querySelectorAll('.judge-card')) {
    c.classList.remove('selected');
    c.setAttribute('aria-pressed', 'false');
  }
  cardEl.classList.add('selected');
  cardEl.setAttribute('aria-pressed', 'true');
  hideError();

  try {
    await apiPost('/api/auth/judge', { judgeId: judge.id });
    window.location.href = '/score';
  } catch (err) {
    signingIn = false;
    cardEl.classList.remove('selected');
    showError(err.message);
    // The admin saved a new config while this page was open, so the list the
    // judge is looking at is stale. Refresh it in place rather than making them
    // work out that they need to reload.
    if (/just updated/i.test(err.message)) loadJudges(dayId);
  }
}

/* ── Error Slot ──────────────────────────────────────────────────────────── */
function showError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError() {
  document.getElementById('login-error')?.classList.add('hidden');
}

/* ── HTML Escape ─────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
