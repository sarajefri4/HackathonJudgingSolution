/* ── Toast Notifications ──────────────────────────────────────────────── */
function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast${type !== 'success' ? ' ' + type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Force reflow then animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, 3200);
}

/* ── API Helpers ─────────────────────────────────────────────────────────── */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    // Explicit, not implied. Older mobile browsers default fetch() to
    // credentials:'omit', which silently drops the session cookie — the judge
    // signs in, the cookie is never stored, /score sees no session and sends
    // them straight back to the login screen.
    credentials: 'same-origin',
    cache:       'no-store',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiGet(url)         { return apiFetch(url); }
async function apiPost(url, body)  { return apiFetch(url, { method: 'POST', body }); }

/* ── Session ─────────────────────────────────────────────────────────────── */
async function getSession() {
  try { return await apiGet('/api/auth/me'); }
  catch { return null; }
}

async function requireAdminSession() {
  const session = await getSession();
  if (!session || session.type !== 'admin') {
    window.location.href = '/admin-setup';
    return null;
  }
  return session;
}

async function requireJudgeSession() {
  const session = await getSession();
  if (!session || session.type !== 'judge') {
    window.location.href = '/judge-login';
    return null;
  }
  return session;
}

/* ── Slider Fill ─────────────────────────────────────────────────────────── */
function updateSliderFill(slider) {
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 10;
  const val = parseFloat(slider.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.background =
    `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-elevated) ${pct}%)`;
}

function initSlider(slider, displayEl) {
  const update = () => {
    updateSliderFill(slider);
    if (displayEl) displayEl.textContent = parseFloat(slider.value).toFixed(1);
  };
  slider.addEventListener('input', update);
  update(); // initial
}

/* ── Weighted Total ──────────────────────────────────────────────────────── */
/**
 * Mirrors the server's calculation in scoring.js: each criterion contributes
 * its value as a fraction of its own max, weighted by its share of the total
 * weight. Weights need not add to 100.
 *
 * @param {Array}  criteria criterion rows ({ id, weight, max_score })
 * @param {Object} values   criterion id → raw score
 * @returns {number} 0–100
 */
function calcTotal(criteria, values) {
  const weightSum = criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
  if (weightSum <= 0) return 0;

  const weighted = criteria.reduce((sum, c) => {
    const max = Number(c.max_score) || 10;
    const raw = Number(values[c.id]) || 0;
    const clamped = Math.min(Math.max(raw, 0), max);
    return sum + (clamped / max) * (Number(c.weight) || 0);
  }, 0);

  return (weighted / weightSum) * 100;
}

/* ── Event Branding ──────────────────────────────────────────────────────── */
/**
 * Fetch the admin-configured event name/tagline and apply them to any element
 * carrying data-event="name" / data-event="tagline", plus the document title.
 * Falls back silently to whatever markup is already on the page.
 */
async function applyEventBranding() {
  let config;
  try { config = await apiGet('/api/config'); }
  catch { return null; }

  const name    = config.event_name;
  const tagline = config.event_tagline;

  if (name) {
    for (const el of document.querySelectorAll('[data-event="name"]')) {
      el.textContent = name;
    }
    const suffix = document.title.includes('—')
      ? document.title.split('—')[0].trim()
      : '';
    document.title = suffix ? `${suffix} — ${name}` : name;
  }
  if (tagline) {
    for (const el of document.querySelectorAll('[data-event="tagline"]')) {
      el.textContent = tagline;
    }
  }
  return config;
}
