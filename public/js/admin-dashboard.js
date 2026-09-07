/* ── Admin Dashboard ──────────────────────────────────────────────────────── */
let currentDayId = null;
let refreshTimer  = null;
let lastRefresh   = null;
const REFRESH_INTERVAL = 30_000; // 30 s

(async () => {
  applyEventBranding();

  const session = await getSession();
  if (session && session.type === 'admin') {
    document.getElementById('pin-modal').classList.add('hidden');
    initDashboard();
  } else {
    document.getElementById('pin-modal').classList.remove('hidden');
    document.getElementById('dash-ui').classList.add('hidden');
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
      document.getElementById('dash-ui').classList.remove('hidden');
      initDashboard();
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
async function initDashboard() {
  document.getElementById('dash-ui').classList.remove('hidden');

  try {
    const days = await apiGet('/api/days');
    buildDayTabs(days);
    if (days.length > 0) {
      currentDayId = days[0].id;
      activateDayTab(currentDayId);
      await loadData();
    }
  } catch (err) {
    showToast('Failed to load days: ' + err.message, 'error');
  }

  document.getElementById('refresh-btn').addEventListener('click', () => loadData(true));
  document.getElementById('export-btn').addEventListener('click', () => {
    if (currentDayId) window.location.href = `/api/admin/export/${currentDayId}`;
  });

  startAutoRefresh();
}

/* ── Day Tabs ────────────────────────────────────────────────────────────── */
function buildDayTabs(days) {
  const bar = document.getElementById('day-tabs');
  bar.innerHTML = '';
  for (const day of days) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.textContent = `${day.name} — ${day.date}`;
    btn.dataset.dayId = day.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.addEventListener('click', async () => {
      currentDayId = day.id;
      activateDayTab(day.id);
      await loadData();
    });
    bar.appendChild(btn);
  }
}

function activateDayTab(dayId) {
  for (const btn of document.querySelectorAll('#day-tabs .tab')) {
    const active = parseInt(btn.dataset.dayId, 10) === dayId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

/* ── Data Loading ────────────────────────────────────────────────────────── */
async function loadData(showFeedback = false) {
  if (!currentDayId) return;
  setRefreshStatus('loading');

  try {
    const data = await apiGet(`/api/admin/dashboard/${currentDayId}`);
    renderDashboard(data);
    lastRefresh = new Date();
    setRefreshStatus('live');
    if (showFeedback) showToast('Dashboard refreshed');
  } catch (err) {
    setRefreshStatus('error');
    showToast('Refresh failed: ' + err.message, 'error');
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadData(), REFRESH_INTERVAL);
}

function setRefreshStatus(status) {
  const dot  = document.getElementById('refresh-dot');
  const text = document.getElementById('refresh-text');
  if (status === 'live') {
    dot.classList.add('live');
    const t = lastRefresh;
    text.textContent = `Live · Last updated ${t.toLocaleTimeString()}`;
  } else if (status === 'loading') {
    dot.classList.remove('live');
    text.textContent = 'Refreshing…';
  } else {
    dot.classList.remove('live');
    text.textContent = 'Failed to refresh';
  }
}

/* ── Render Dashboard ────────────────────────────────────────────────────── */
function renderDashboard({ day, teams, judges, criteria, scores, teamAverages, totalJudges }) {
  renderStats(teams, judges, scores, totalJudges);
  renderLeaderboard(teamAverages, totalJudges);
  renderScoreGrid(teams, judges, scores);
  renderCriteriaBreakdown(teams, criteria, scores);
}

/* Stats Row */
function renderStats(teams, judges, scores, totalJudges) {
  const totalPossible = teams.length * totalJudges;
  const submitted     = scores.length;
  const pct           = totalPossible > 0 ? Math.round(submitted / totalPossible * 100) : 0;

  const avgAll = scores.length > 0
    ? (scores.reduce((s, r) => s + r.total, 0) / scores.length).toFixed(1)
    : '—';

  document.getElementById('stat-row').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${teams.length}</div>
      <div class="stat-label">Teams</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalJudges}</div>
      <div class="stat-label">Judges</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${submitted}<span style="font-size:1rem;color:var(--text-muted);">/${totalPossible}</span></div>
      <div class="stat-label">Scores submitted (${pct}%)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${avgAll !== '—' ? 'var(--accent)' : 'var(--text-dim)'}">${avgAll}</div>
      <div class="stat-label">Overall avg score</div>
    </div>
  `;
}

/* Leaderboard */
function renderLeaderboard(teamAverages, totalJudges) {
  const el = document.getElementById('leaderboard');
  if (teamAverages.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>No teams configured for this day.</p></div>';
    return;
  }

  // Sort: teams with scores descending, then unscoredteams at bottom
  const sorted = [...teamAverages].sort((a, b) => {
    if (a.average === null && b.average === null) return 0;
    if (a.average === null) return 1;
    if (b.average === null) return -1;
    return b.average - a.average;
  });

  el.innerHTML = '';
  sorted.forEach((item, i) => {
    const rank    = i + 1;
    const hasScore = item.average !== null;
    const displayScore = hasScore ? item.average.toFixed(1) : '—';
    const pct     = hasScore ? Math.min(100, item.average) : 0;
    const isTop   = rank === 1 && hasScore;

    const row = document.createElement('div');
    row.className = `lb-row${isTop ? ' rank-1' : ''}`;
    row.innerHTML = `
      <div class="lb-rank${isTop ? ' top' : ''}">${rank}</div>
      <div class="lb-info">
        <div class="lb-name">${escHtml(item.teamName)}</div>
        <div class="lb-meta">${item.count} of ${totalJudges} judge${totalJudges !== 1 ? 's' : ''} scored</div>
      </div>
      <div class="lb-bar-wrap">
        <div class="progress-track">
          <div class="progress-fill${pct < 40 ? ' low' : pct < 65 ? ' medium' : ''}"
               style="width:${pct}%" role="progressbar"
               aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
      </div>
      <div class="lb-score${hasScore ? '' : ' no-score'}">${displayScore}</div>
    `;
    el.appendChild(row);
  });
}

/* Score Grid */
function renderScoreGrid(teams, judges, scores) {
  const table = document.getElementById('score-grid');
  if (teams.length === 0 || judges.length === 0) {
    table.innerHTML = '<tr><td style="padding:32px;text-align:center;color:var(--text-muted);">No teams or judges configured.</td></tr>';
    return;
  }

  // Build lookup: `judgeId-teamId` → score
  const lookup = new Map(scores.map(s => [`${s.judge_id}-${s.team_id}`, s]));

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th scope="col">Judge</th>`;
  for (const team of teams) {
    headerRow.innerHTML += `<th scope="col">${escHtml(team.name)}</th>`;
  }
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');

  for (const judge of judges) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${escHtml(judge.name)}</strong></td>`;
    for (const team of teams) {
      const score = lookup.get(`${judge.id}-${team.id}`);
      if (!score) {
        tr.innerHTML += `<td class="cell-empty">—</td>`;
      } else {
        const cls = score.total >= 75 ? 'text-accent' : score.total < 40 ? 'text-danger' : '';
        tr.innerHTML += `<td class="${cls}">${score.total.toFixed(1)}</td>`;
      }
    }
    tbody.appendChild(tr);
  }

  // Average row
  const avgTr = document.createElement('tr');
  avgTr.className = 'avg-row';
  avgTr.innerHTML = `<td>Average</td>`;
  for (const team of teams) {
    const teamScores = scores.filter(s => s.team_id === team.id);
    if (teamScores.length === 0) {
      avgTr.innerHTML += `<td class="cell-empty">—</td>`;
    } else {
      const avg = teamScores.reduce((s, r) => s + r.total, 0) / teamScores.length;
      avgTr.innerHTML += `<td class="text-accent">${avg.toFixed(1)}</td>`;
    }
  }
  tbody.appendChild(avgTr);

  table.innerHTML = '';
  table.appendChild(thead);
  table.appendChild(tbody);

  document.getElementById('grid-legend').textContent =
    `${judges.length} judge${judges.length !== 1 ? 's' : ''} × ${teams.length} team${teams.length !== 1 ? 's' : ''}`;
}

/* Criteria Breakdown — average raw score per criterion, per team */
function renderCriteriaBreakdown(teams, criteria, scores) {
  const table  = document.getElementById('criteria-grid');
  const legend = document.getElementById('criteria-legend');

  if (!criteria || criteria.length === 0) {
    table.innerHTML = '<tr><td style="padding:32px;text-align:center;color:var(--text-muted);">No criteria configured.</td></tr>';
    legend.textContent = '';
    return;
  }
  if (teams.length === 0) {
    table.innerHTML = '<tr><td style="padding:32px;text-align:center;color:var(--text-muted);">No teams configured.</td></tr>';
    legend.textContent = '';
    return;
  }

  const weightSum = criteria.reduce((s, c) => s + c.weight, 0) || 1;

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = '<th scope="col">Criterion</th>';
  for (const team of teams) {
    headerRow.innerHTML += `<th scope="col">${escHtml(team.name)}</th>`;
  }
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');
  for (const c of criteria) {
    const tr = document.createElement('tr');
    const pct = Math.round(c.weight / weightSum * 100);
    tr.innerHTML = `
      <td>
        <strong>${escHtml(c.label)}</strong>
        <span class="text-muted text-sm"> · ${pct}% · /${c.max_score}</span>
      </td>`;

    for (const team of teams) {
      // Only scores that actually recorded this criterion count toward its average.
      const vals = scores
        .filter(s => s.team_id === team.id)
        .map(s => s.values?.[c.id])
        .filter(v => v !== undefined);

      if (vals.length === 0) {
        tr.innerHTML += '<td class="cell-empty">—</td>';
      } else {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const share = avg / c.max_score;
        const cls = share >= 0.75 ? 'text-accent' : share < 0.4 ? 'text-danger' : '';
        tr.innerHTML += `<td class="${cls}">${avg.toFixed(1)}</td>`;
      }
    }
    tbody.appendChild(tr);
  }

  table.innerHTML = '';
  table.appendChild(thead);
  table.appendChild(tbody);

  legend.textContent = `${criteria.length} criteri${criteria.length !== 1 ? 'a' : 'on'} · average raw score per team`;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
