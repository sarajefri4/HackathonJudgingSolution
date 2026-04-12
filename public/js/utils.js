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
function calcTotal(impact, analysis, story, feasibility) {
  return (impact / 10 * 0.30 + analysis / 10 * 0.25 + story / 10 * 0.30 + feasibility / 10 * 0.15) * 100;
}
