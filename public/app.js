/* ── State ──────────────────────────────────────────────────────────────── */
let allWeeks     = [];
let activeWeek   = null;
let players      = [];
let selectedFile = null;
let adminUnlocked = false;
let adminPassword = '';

/* ── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await bootstrap();
  setupTabs();
  setupUpload();
  setupAdmin();
});

async function bootstrap() {
  try {
    const [weeksRes, activeRes, playersRes] = await Promise.all([
      fetch('/api/gameweeks'),
      fetch('/api/gameweeks/active'),
      fetch('/api/players'),
    ]);
    allWeeks   = await weeksRes.json();
    activeWeek = await activeRes.json();
    players    = await playersRes.json();
  } catch (e) {
    console.error('Bootstrap error:', e);
  }

  renderHeader();
  populateWeekFilter();
  populatePlayersList();
  await renderLeaderboard();
  await renderThisWeekBets();
  renderHistoryPills();
  renderUploadWeekName();
}

/* ── Header ─────────────────────────────────────────────────────────────── */
function renderHeader() {
  const pill = document.getElementById('activeWeekPill');
  pill.textContent = activeWeek ? activeWeek.name : 'No active week';
}

/* ── Tab switching ───────────────────────────────────────────────────────── */
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`tab-${name}`).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');

  if (name === 'home') {
    renderLeaderboard();
    renderThisWeekBets();
  }
}

/* ── Leaderboard ─────────────────────────────────────────────────────────── */
function populateWeekFilter() {
  const sel = document.getElementById('weekFilter');
  allWeeks.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => renderLeaderboard(sel.value || null));
}

async function renderLeaderboard(weekId = null) {
  const wrap = document.getElementById('leaderboardWrap');
  const url  = weekId ? `/api/leaderboard?weekId=${weekId}` : '/api/leaderboard';
  try {
    const data = await fetch(url).then(r => r.json());
    wrap.innerHTML = buildLeaderboardTable(data, weekId);
  } catch {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div>Could not load leaderboard</div></div>';
  }
}

function buildLeaderboardTable(rows, weekId) {
  if (!rows.length) {
    return '<div class="empty-state"><div class="empty-icon">🏆</div><div>No players yet — upload the first bet!</div></div>';
  }

  const medals = ['🥇', '🥈', '🥉'];
  const trs = rows.map((row, i) => {
    const rank     = medals[i] ?? `${i + 1}`;
    const profit   = row.profit;
    const pClass   = profit > 0 ? 'profit-pos' : profit < 0 ? 'profit-neg' : 'profit-nil';
    const pText    = profit >= 0
      ? `+£${profit.toFixed(2)}`
      : `−£${Math.abs(profit).toFixed(2)}`;
    const avgOdds  = row.avgOdds != null ? `${row.avgOdds.toFixed(2)}x` : '—';
    const winsText = weekId
      ? (row.bet ? resultBadge(row.bet.result) : '<span class="result-badge badge-void">No bet</span>')
      : `${row.winners}/${row.totalBets}`;

    return `<tr>
      <td class="cell-rank">${rank}</td>
      <td class="cell-player">${esc(row.playerName)}</td>
      <td class="cell-profit ${pClass}">${pText}</td>
      <td class="cell-wins">${winsText}</td>
      <td class="cell-odds">${avgOdds}</td>
    </tr>`;
  }).join('');

  const winsHeader = weekId ? 'Result' : 'W/P';

  return `<div class="table-wrap">
    <table class="lb-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Profit</th>
          <th>${winsHeader}</th>
          <th>Avg Odds</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>
  </div>`;
}

function resultBadge(result) {
  const map = {
    won:     ['badge-won',     'Won'],
    lost:    ['badge-lost',    'Lost'],
    pending: ['badge-pending', 'Pending'],
    void:    ['badge-void',    'Void'],
  };
  const [cls, label] = map[result] ?? ['badge-void', result ?? '—'];
  return `<span class="result-badge ${cls}">${label}</span>`;
}

/* ── This week's bets grid ───────────────────────────────────────────────── */
async function renderThisWeekBets() {
  const grid    = document.getElementById('weekBetsGrid');
  const heading = document.getElementById('weekBetsHeading');

  if (!activeWeek) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📅</div><div>No active game week set</div></div>';
    return;
  }

  heading.textContent = `${activeWeek.name} — Bets`;

  try {
    const bets = await fetch(`/api/gameweeks/${activeWeek.id}/bets`).then(r => r.json());
    if (!bets.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📸</div><div>No bets submitted yet this week</div></div>';
      return;
    }
    grid.innerHTML = bets.map(betCard).join('');
  } catch {
    grid.innerHTML = '';
  }
}

function betCard(bet) {
  const imgSrc = bet.imageUrl || bet.image_url;
  const imgTag = imgSrc
    ? `<img class="bet-card-img" src="${esc(imgSrc)}" alt="betslip" loading="lazy">`
    : `<div class="bet-card-img-placeholder">🎫</div>`;

  const selection = bet.selection || 'Pending analysis…';
  const odds      = bet.odds != null ? `${bet.odds.toFixed(2)}x` : '';

  return `<div class="bet-card">
    ${imgTag}
    <div class="bet-card-info">
      <div class="bet-card-player">${esc(bet.playerName)}</div>
      <div class="bet-card-selection">${esc(selection)}</div>
      <div class="bet-card-footer">
        <span class="bet-card-odds">${odds}</span>
        ${resultBadge(bet.result)}
      </div>
    </div>
  </div>`;
}

/* ── History ─────────────────────────────────────────────────────────────── */
function renderHistoryPills() {
  const container = document.getElementById('weekPills');
  container.innerHTML = allWeeks.map(w =>
    `<button class="week-pill-btn" data-week-id="${w.id}">${esc(w.name)}</button>`
  ).join('');

  container.querySelectorAll('.week-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.week-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadHistoryWeek(parseInt(btn.dataset.weekId));
    });
  });
}

async function loadHistoryWeek(weekId) {
  const content = document.getElementById('historyContent');
  content.innerHTML = '<div class="skeleton-table"></div>';
  try {
    const [lbData, bets] = await Promise.all([
      fetch(`/api/leaderboard?weekId=${weekId}`).then(r => r.json()),
      fetch(`/api/gameweeks/${weekId}/bets`).then(r => r.json()),
    ]);

    const week  = allWeeks.find(w => w.id === weekId);
    const table = buildLeaderboardTable(lbData, weekId);
    const grid  = bets.length
      ? `<div class="bets-grid" style="margin-top:16px">${bets.map(betCard).join('')}</div>`
      : '';

    content.innerHTML = `
      <h2 class="section-title" style="margin-bottom:12px">${esc(week?.name ?? '')}</h2>
      ${table}${grid}`;
  } catch {
    content.innerHTML = '<div class="empty-state"><div>Failed to load</div></div>';
  }
}

/* ── Upload ──────────────────────────────────────────────────────────────── */
function renderUploadWeekName() {
  document.getElementById('uploadWeekName').textContent = activeWeek ? activeWeek.name : 'No active week';
}

function setupUpload() {
  const dropZone   = document.getElementById('dropZone');
  const fileInput  = document.getElementById('betslipInput');
  const uploadBtn  = document.getElementById('uploadBtn');
  const nameInput  = document.getElementById('playerNameInput');

  // Click / tap
  dropZone.addEventListener('click', () => { if (!selectedFile) fileInput.click(); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

  // Drag & drop
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  });

  // Enable button when both file + name present
  nameInput.addEventListener('input', updateUploadBtn);

  // Upload
  uploadBtn.addEventListener('click', handleUpload);
}

function setFile(file) {
  selectedFile = file;
  const preview = document.getElementById('imagePreview');
  const inner   = document.getElementById('dropZoneInner');
  const reader  = new FileReader();
  reader.onload = e => {
    preview.src = e.target.result;
    preview.classList.remove('hidden');
    inner.classList.add('hidden');
  };
  reader.readAsDataURL(file);
  updateUploadBtn();
}

function updateUploadBtn() {
  const name = document.getElementById('playerNameInput').value.trim();
  document.getElementById('uploadBtn').disabled = !(selectedFile && name && activeWeek);
}

async function handleUpload() {
  const name   = document.getElementById('playerNameInput').value.trim();
  const status = document.getElementById('uploadStatus');
  const card   = document.getElementById('analysisCard');

  if (!selectedFile || !name || !activeWeek) return;

  setUploadStatus('loading', 'Uploading and analysing your betslip…');
  card.classList.add('hidden');
  document.getElementById('uploadBtn').disabled = true;

  const fd = new FormData();
  fd.append('betslip', selectedFile);
  fd.append('playerName', name);
  fd.append('gameWeekId', activeWeek.id);

  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) {
      setUploadStatus('error', data.error || 'Upload failed');
      document.getElementById('uploadBtn').disabled = false;
      return;
    }

    if (data.warning) {
      setUploadStatus('success', `Bet saved! ${data.warning}`);
    } else {
      setUploadStatus('success', `Betslip uploaded for ${esc(data.playerName)} ✓`);
    }

    if (data.analysis) renderAnalysisCard(data.analysis);

    // Reset for next upload
    selectedFile = null;
    document.getElementById('betslipInput').value = '';
    document.getElementById('imagePreview').classList.add('hidden');
    document.getElementById('dropZoneInner').classList.remove('hidden');
    document.getElementById('playerNameInput').value = '';
    updateUploadBtn();

    // Refresh players list
    players = await fetch('/api/players').then(r => r.json());
    populatePlayersList();

  } catch (err) {
    setUploadStatus('error', 'Network error — please try again');
    document.getElementById('uploadBtn').disabled = false;
  }
}

function setUploadStatus(type, msg) {
  const el = document.getElementById('uploadStatus');
  el.className = `upload-status status-${type}`;
  const icon = type === 'loading' ? '<span class="spinner"></span>' : type === 'success' ? '✓' : '✗';
  el.innerHTML = `${icon} ${msg}`;
  el.classList.remove('hidden');
}

function renderAnalysisCard(a) {
  const card = document.getElementById('analysisCard');
  const resultCls = `result-${a.result || 'pending'}`;

  const profit = a.profit != null
    ? (a.profit >= 0 ? `+£${a.profit.toFixed(2)}` : `−£${Math.abs(a.profit).toFixed(2)}`)
    : '—';

  card.className = `analysis-card ${resultCls}`;
  card.innerHTML = `
    <div class="analysis-header">
      <span class="analysis-title">Betslip Analysis</span>
      ${resultBadge(a.result || 'pending')}
    </div>
    <div class="analysis-body">
      ${(a.event_name || a.event) ? analysisRow('Event', esc(a.event_name || a.event)) : ''}
      ${analysisRow('Selection', esc(a.selection || '—'))}
      ${analysisRow('Odds', a.odds != null ? `${parseFloat(a.odds).toFixed(2)}x` : '—')}
      ${analysisRow('Stake', a.stake != null ? `£${parseFloat(a.stake).toFixed(2)}` : '£5.00')}
      ${analysisRow('Profit / Loss', profit)}
      ${a.betType ? analysisRow('Bet Type', esc(a.betType)) : ''}
    </div>`;
  card.classList.remove('hidden');
}

function analysisRow(label, value) {
  return `<div class="analysis-row">
    <span class="analysis-label">${label}</span>
    <span class="analysis-value">${value}</span>
  </div>`;
}

function populatePlayersList() {
  const dl = document.getElementById('playersList');
  dl.innerHTML = players.map(p => `<option value="${esc(p.name)}">`).join('');
}

/* ── Admin ───────────────────────────────────────────────────────────────── */
function setupAdmin() {
  const unlockBtn = document.getElementById('adminUnlockBtn');
  const pwdInput  = document.getElementById('adminPassword');

  unlockBtn.addEventListener('click', tryUnlock);
  pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

  document.getElementById('adminSetWeekBtn').addEventListener('click', adminSetWeek);
  document.getElementById('adminWeekFilter').addEventListener('change', e => {
    if (e.target.value) loadAdminBets(parseInt(e.target.value));
  });
}

function tryUnlock() {
  const pwd = document.getElementById('adminPassword').value;
  adminPassword = pwd;
  adminUnlocked = true;

  document.getElementById('adminLock').classList.add('hidden');
  document.getElementById('adminPanel').classList.remove('hidden');
  populateAdminWeekSelects();
}

function populateAdminWeekSelects() {
  const sel1 = document.getElementById('adminWeekSelect');
  const sel2 = document.getElementById('adminWeekFilter');

  sel1.innerHTML = allWeeks.map(w =>
    `<option value="${w.id}" ${w.isActive ? 'selected' : ''}>${esc(w.name)}</option>`
  ).join('');

  sel2.innerHTML = '<option value="">Choose a game week…</option>' +
    allWeeks.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
}

async function adminSetWeek() {
  const weekId = parseInt(document.getElementById('adminWeekSelect').value);
  const msg    = document.getElementById('adminWeekMsg');
  try {
    const res = await fetch(`/api/gameweeks/${weekId}/activate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword }),
    });
    const data = await res.json();
    if (!res.ok) { showAdminMsg(msg, data.error, false); return; }

    activeWeek = data.activeWeek || allWeeks.find(w => w.id === weekId);
    allWeeks   = allWeeks.map(w => ({ ...w, isActive: w.id === weekId }));
    renderHeader();
    renderUploadWeekName();
    showAdminMsg(msg, 'Active week updated ✓', true);
  } catch {
    showAdminMsg(msg, 'Request failed', false);
  }
}

function showAdminMsg(el, text, success) {
  el.textContent  = text;
  el.className    = success ? 'success-msg' : 'error-msg';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

async function loadAdminBets(weekId) {
  const list = document.getElementById('adminBetsList');
  list.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const bets = await fetch(`/api/gameweeks/${weekId}/bets`).then(r => r.json());
    if (!bets.length) {
      list.innerHTML = '<div class="empty-state"><div>No bets submitted for this week</div></div>';
      return;
    }
    list.innerHTML = bets.map(b => adminBetRow(b, weekId)).join('');
  } catch {
    list.innerHTML = '<div class="empty-state"><div>Failed to load</div></div>';
  }
}

function adminBetRow(bet, weekId) {
  return `<div class="admin-bet-row" id="admin-bet-${bet.id}">
    <div class="admin-bet-top">
      <span class="admin-bet-player">${esc(bet.playerName)}</span>
      ${resultBadge(bet.result)}
    </div>
    <div class="admin-bet-selection">
      ${bet.selection ? esc(bet.selection) : 'No selection extracted'}
      ${bet.odds != null ? ` · ${bet.odds.toFixed(2)}x` : ''}
    </div>
    ${(bet.imageUrl || bet.image_url) ? `<a href="${esc(bet.imageUrl || bet.image_url)}" target="_blank" style="font-size:0.75rem;color:var(--blue)">View betslip →</a>` : ''}
    <div class="admin-bet-controls">
      <button class="btn-won"  onclick="markResult(${bet.id}, 'won',  ${weekId})">✓ Won</button>
      <button class="btn-lost" onclick="markResult(${bet.id}, 'lost', ${weekId})">✗ Lost</button>
      <button class="btn-void" onclick="markResult(${bet.id}, 'void', ${weekId})">— Void</button>
      <button class="btn-del"  onclick="deleteBet(${bet.id}, ${weekId})">Delete</button>
    </div>
  </div>`;
}

async function markResult(betId, result, weekId) {
  try {
    const res = await fetch(`/api/bets/${betId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result, password: adminPassword }),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    await loadAdminBets(weekId);
  } catch {
    alert('Failed to update bet');
  }
}

async function deleteBet(betId, weekId) {
  if (!confirm('Delete this bet? This cannot be undone.')) return;
  try {
    const res = await fetch(`/api/bets/${betId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword }),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    await loadAdminBets(weekId);
  } catch {
    alert('Failed to delete');
  }
}

/* ── Utils ───────────────────────────────────────────────────────────────── */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
