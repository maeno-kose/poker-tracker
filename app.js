/* Poker Hand Tracker — main app logic */
(function () {
'use strict';

// =========================================================================
// Position labels per table size
// =========================================================================
const POSITIONS = {
  2:  ['SB', 'BB'],
  3:  ['BTN', 'SB', 'BB'],
  4:  ['CO', 'BTN', 'SB', 'BB'],
  5:  ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  6:  ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7:  ['UTG', 'UTG+1', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8:  ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9:  ['UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  10: ['UTG', 'UTG+1', 'UTG+2', 'MP1', 'MP2', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

function categoryFromTableSize(n) {
  if (n <= 2) return 'HU';
  if (n <= 6) return 'Short';
  return 'FullRing';
}

// =========================================================================
// State
// =========================================================================
const state = {
  active: null,         // active session object
  tickInt: null,        // interval id for elapsed clock
  snapshotIntervalDefault: 50,
  filter: 'all',
};

// =========================================================================
// DOM helpers
// =========================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
}

// =========================================================================
// Toast
// =========================================================================
let _toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// =========================================================================
// Modal
// =========================================================================
function modal({ title, bodyNode, okText = 'OK', cancelText = 'キャンセル', hideCancel = false }) {
  return new Promise((resolve) => {
    $('#modal-title').textContent = title;
    const body = $('#modal-body');
    body.innerHTML = '';
    body.append(bodyNode);
    $('#modal-ok').textContent = okText;
    $('#modal-cancel').textContent = cancelText;
    $('#modal-cancel').style.display = hideCancel ? 'none' : '';
    $('#modal-bg').hidden = false;

    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onBg = (e) => { if (e.target === $('#modal-bg')) onCancel(); };
    function cleanup() {
      $('#modal-ok').removeEventListener('click', onOk);
      $('#modal-cancel').removeEventListener('click', onCancel);
      $('#modal-bg').removeEventListener('click', onBg);
      $('#modal-bg').hidden = true;
    }
    $('#modal-ok').addEventListener('click', onOk);
    $('#modal-cancel').addEventListener('click', onCancel);
    $('#modal-bg').addEventListener('click', onBg);
  });
}

async function promptNumber(title, label, initial = '') {
  const input = el('input', {
    type: 'number', inputmode: 'decimal', step: '1',
    style: 'width:100%;',
    value: initial,
  });
  const body = el('label', { style: 'display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--text-dim);' }, label, input);
  setTimeout(() => input.focus(), 50);
  const ok = await modal({ title, bodyNode: body });
  if (!ok) return null;
  const v = parseFloat(input.value);
  return Number.isFinite(v) ? v : null;
}

async function confirmDialog(title, msg) {
  const body = el('div', { style: 'font-size:14px;color:var(--text);' }, msg);
  return await modal({ title, bodyNode: body, okText: 'OK' });
}

// =========================================================================
// Time helpers
// =========================================================================
function fmtElapsed(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fmtHours(ms) {
  const h = ms / 3600000;
  if (h >= 10) return `${h.toFixed(1)}h`;
  return `${h.toFixed(2)}h`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return sign + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// breaks may contain unterminated current break (end === null)
function sessionEffectiveMs(s, now = Date.now()) {
  const start = new Date(s.startTime).getTime();
  const ref = s.endTime ? new Date(s.endTime).getTime() : now;
  let breakMs = 0;
  for (const b of s.breaks || []) {
    const bs = new Date(b.start).getTime();
    const be = b.end ? new Date(b.end).getTime() : ref;
    breakMs += Math.max(0, be - bs);
  }
  return Math.max(0, ref - start - breakMs);
}
function isOnBreak(s) {
  if (!s.breaks || s.breaks.length === 0) return false;
  return s.breaks[s.breaks.length - 1].end == null;
}
function buyinTotal(s) {
  let total = s.buyinInitial || 0;
  for (const r of s.rebuys || []) total += r.amount || 0;
  return total;
}

// =========================================================================
// Stats
// =========================================================================
function statsOf(hands) {
  // hands: array of {action, position}
  let fold = 0, call = 0, raise = 0, threeb = 0, bb = 0;
  for (const h of hands) {
    switch (h.action) {
      case 'fold': fold++; break;
      case 'call': call++; break;
      case 'raise': raise++; break;
      case '3bet': threeb++; break;
      case 'bbcheck': bb++; break;
    }
  }
  const total = fold + call + raise + threeb + bb;
  const vpipNum = call + raise + threeb;
  const pfrNum = raise + threeb;
  return {
    total, fold, call, raise, threeb, bb,
    vpipNum, pfrNum, threebNum: threeb,
    vpip: total ? vpipNum / total : 0,
    pfr: total ? pfrNum / total : 0,
    threebPct: total ? threeb / total : 0,
  };
}

// =========================================================================
// Position cycling
// =========================================================================
function nextPositionIdx(s) {
  const arr = POSITIONS[s.tableSize] || POSITIONS[6];
  return (s.currentPositionIdx + 1) % arr.length;
}
function prevPositionIdx(s) {
  const arr = POSITIONS[s.tableSize] || POSITIONS[6];
  return (s.currentPositionIdx - 1 + arr.length) % arr.length;
}
function currentPositionLabel(s) {
  const arr = POSITIONS[s.tableSize] || POSITIONS[6];
  return arr[s.currentPositionIdx] || '?';
}

// =========================================================================
// Render top bar
// =========================================================================
function renderTopBar() {
  const s = state.active;
  const stats = s ? statsOf(s.hands) : { total: 0, vpip: 0, pfr: 0, threebPct: 0 };

  $('#hand-count').textContent = stats.total;
  $('#vpip-pct').textContent = Math.round(stats.vpip * 100) + '%';
  $('#pfr-pct').textContent = Math.round(stats.pfr * 100) + '%';
  $('#threeb-pct').textContent = Math.round(stats.threebPct * 100) + '%';

  const dash = Math.max(0, 100 - Math.min(100, stats.vpip * 100));
  $('#vpip-ring').style.strokeDashoffset = dash;

  $('#elapsed').textContent = s ? fmtElapsed(sessionEffectiveMs(s)) : '00:00';
}

// =========================================================================
// Render active session view
// =========================================================================
function renderSessionView() {
  const s = state.active;
  if (!s) {
    $('#no-session-view').hidden = false;
    $('#active-session-view').hidden = true;
    populateStartForm();
    return;
  }
  $('#no-session-view').hidden = true;
  $('#active-session-view').hidden = false;

  $('#pos-current-label').textContent = currentPositionLabel(s);
  const arr = POSITIONS[s.tableSize] || POSITIONS[6];
  $('#pos-sub').textContent = `次=${arr[nextPositionIdx(s)]} (${arr.length}-handed)`;

  $('#break-banner').hidden = !isOnBreak(s);
  $('#break-btn').classList.toggle('active', isOnBreak(s));
  $('#break-btn').textContent = isOnBreak(s) ? '復帰' : '離席';

  $('#meta-venue').textContent = s.venue || '(会場未設定)';
  $('#meta-blinds').textContent = `${s.blinds.sb}/${s.blinds.bb}`;
  $('#meta-table').textContent = `${s.tableSize}-handed (${s.category})`;
  $('#meta-buyin').textContent = `バイイン: ${fmtMoney(buyinTotal(s))}`;

  const lastSnap = (s.snapshots && s.snapshots.length)
    ? s.snapshots[s.snapshots.length - 1] : null;
  $('#meta-last-snap').textContent = lastSnap
    ? `最終チップ: ${fmtMoney(lastSnap.stack)} (#${lastSnap.handIdx})`
    : '最終チップ: 未記録';
}

// =========================================================================
// Action handlers
// =========================================================================
async function recordAction(action) {
  const s = state.active;
  if (!s) return;
  if (isOnBreak(s)) {
    toast('離席中です。復帰してから記録してください');
    return;
  }
  const pos = currentPositionLabel(s);
  s.hands.push({
    action,
    position: pos,
    time: new Date().toISOString(),
  });
  s.currentPositionIdx = nextPositionIdx(s);
  await DB.putSession(s);
  renderTopBar();
  renderSessionView();
  maybePromptSnapshot();
}

async function undoLastHand() {
  const s = state.active;
  if (!s) return;
  if (!s.hands.length) {
    toast('取り消せるハンドがありません');
    return;
  }
  s.hands.pop();
  s.currentPositionIdx = prevPositionIdx(s);
  await DB.putSession(s);
  renderTopBar();
  renderSessionView();
  toast('1ハンド取り消しました');
}

async function toggleBreak() {
  const s = state.active;
  if (!s) return;
  if (isOnBreak(s)) {
    s.breaks[s.breaks.length - 1].end = new Date().toISOString();
  } else {
    s.breaks = s.breaks || [];
    s.breaks.push({ start: new Date().toISOString(), end: null });
  }
  await DB.putSession(s);
  renderTopBar();
  renderSessionView();
}

async function doRebuy() {
  const s = state.active;
  if (!s) return;
  const v = await promptNumber('リバイ / アドオン', '追加バイイン額', '');
  if (v == null || v <= 0) return;
  s.rebuys = s.rebuys || [];
  s.rebuys.push({ time: new Date().toISOString(), amount: v });
  await DB.putSession(s);
  toast(`+${v} を追加`);
  renderSessionView();
}

async function takeSnapshot(opts = {}) {
  const s = state.active;
  if (!s) return;
  const promptMsg = opts.auto
    ? `${s.hands.length}ハンド経過。現在のチップ数を入力してください`
    : '現在のチップ数';
  const v = await promptNumber('チップ数記録', promptMsg, '');
  if (v == null) {
    // user cancelled — don't push; remember last prompt point to avoid spam
    s._lastSnapPromptHand = s.hands.length;
    await DB.putSession(s);
    return;
  }
  s.snapshots = s.snapshots || [];
  s.snapshots.push({
    time: new Date().toISOString(),
    handIdx: s.hands.length,
    stack: v,
  });
  s._lastSnapPromptHand = s.hands.length;
  await DB.putSession(s);
  toast(`チップ ${fmtMoney(v)} を記録`);
  renderSessionView();
}

function maybePromptSnapshot() {
  const s = state.active;
  if (!s) return;
  const interval = s.snapshotInterval || 0;
  if (!interval) return;
  const last = s._lastSnapPromptHand || 0;
  if (s.hands.length - last >= interval) {
    takeSnapshot({ auto: true });
  }
}

async function endSession() {
  const s = state.active;
  if (!s) return;
  if (isOnBreak(s)) {
    s.breaks[s.breaks.length - 1].end = new Date().toISOString();
  }
  const v = await promptNumber('セッション終了', 'キャッシュアウト額', '');
  if (v == null) return;
  s.cashout = v;
  s.endTime = new Date().toISOString();
  s.status = 'ended';
  // close any open break already handled above
  await DB.putSession(s);
  state.active = null;
  stopClock();
  renderTopBar();
  renderSessionView();
  toast('セッション終了 — 記録タブに保存');
  switchTab('record');
  renderRecordTab();
}

// =========================================================================
// Start session
// =========================================================================
function populateStartForm() {
  // re-render position select based on current table size
  const ts = parseInt($('#f-table-size').value, 10);
  const sel = $('#f-start-pos');
  const arr = POSITIONS[ts] || POSITIONS[6];
  sel.innerHTML = '';
  arr.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = p;
    sel.append(o);
  });
  // default to UTG-most position (idx 0) — first to act preflop
  sel.value = '0';
}

async function startSession(e) {
  e.preventDefault();
  const tableSize = parseInt($('#f-table-size').value, 10);
  const session = {
    startTime: new Date().toISOString(),
    endTime: null,
    status: 'active',
    venue: $('#f-venue').value.trim(),
    blinds: {
      sb: parseFloat($('#f-sb').value) || 0,
      bb: parseFloat($('#f-bb').value) || 0,
    },
    tableSize,
    category: $('#f-category').value,
    buyinInitial: parseFloat($('#f-buyin').value) || 0,
    rebuys: [],
    cashout: null,
    hands: [],
    snapshots: [],
    breaks: [],
    currentPositionIdx: parseInt($('#f-start-pos').value, 10) || 0,
    snapshotInterval: state.snapshotIntervalDefault,
    _lastSnapPromptHand: 0,
  };
  const id = await DB.addSession(session);
  session.id = id;
  state.active = session;
  startClock();
  renderTopBar();
  renderSessionView();
  toast('セッション開始');
}

// =========================================================================
// Clock
// =========================================================================
function startClock() {
  if (state.tickInt) clearInterval(state.tickInt);
  state.tickInt = setInterval(() => {
    if (state.active) {
      $('#elapsed').textContent = fmtElapsed(sessionEffectiveMs(state.active));
    }
  }, 1000);
}
function stopClock() {
  if (state.tickInt) { clearInterval(state.tickInt); state.tickInt = null; }
}

// =========================================================================
// Record tab
// =========================================================================
async function renderRecordTab() {
  const all = await DB.listSessions();
  const ended = all.filter((s) => s.status === 'ended');
  const filtered = (state.filter === 'all')
    ? ended
    : ended.filter((s) => s.category === state.filter);

  // ----- Lifetime aggregate -----
  let agg = { total: 0, vpipNum: 0, pfrNum: 0, threebNum: 0 };
  let totalMs = 0, totalProfit = 0, totalBBWon = 0;
  const posAgg = {};
  for (const s of filtered) {
    const st = statsOf(s.hands);
    agg.total += st.total;
    agg.vpipNum += st.vpipNum;
    agg.pfrNum += st.pfrNum;
    agg.threebNum += st.threebNum;
    totalMs += sessionEffectiveMs(s);
    const profit = (s.cashout || 0) - buyinTotal(s);
    totalProfit += profit;
    if (s.blinds && s.blinds.bb > 0) totalBBWon += profit / s.blinds.bb;
    // per-position
    for (const h of s.hands) {
      const p = h.position || '?';
      posAgg[p] = posAgg[p] || { hands: 0, vpip: 0, pfr: 0 };
      posAgg[p].hands++;
      if (h.action === 'call' || h.action === 'raise' || h.action === '3bet') posAgg[p].vpip++;
      if (h.action === 'raise' || h.action === '3bet') posAgg[p].pfr++;
    }
  }
  $('#lt-hands').textContent = agg.total;
  $('#lt-vpip').textContent = agg.total ? Math.round(agg.vpipNum / agg.total * 100) + '%' : '0%';
  $('#lt-pfr').textContent = agg.total ? Math.round(agg.pfrNum / agg.total * 100) + '%' : '0%';
  $('#lt-3bet').textContent = agg.total ? Math.round(agg.threebNum / agg.total * 100) + '%' : '0%';
  $('#lt-time').textContent = fmtHours(totalMs);
  $('#lt-profit').textContent = fmtMoney(totalProfit);
  const hours = totalMs / 3600000;
  $('#lt-hourly').textContent = hours > 0 ? fmtMoney(totalProfit / hours) + '/h' : '—';
  $('#lt-bb100').textContent = agg.total > 0 ? (totalBBWon * 100 / agg.total).toFixed(1) : '0';

  // ----- Position table -----
  const order = ['UTG','UTG+1','UTG+2','MP','MP1','MP2','HJ','CO','BTN','SB','BB'];
  const tbody = $('#pos-table tbody');
  tbody.innerHTML = '';
  const positions = Object.keys(posAgg).sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  for (const p of positions) {
    const d = posAgg[p];
    tbody.append(el('tr', null,
      el('td', null, p),
      el('td', null, String(d.hands)),
      el('td', null, Math.round(d.vpip / d.hands * 100) + '%'),
      el('td', null, Math.round(d.pfr / d.hands * 100) + '%'),
    ));
  }
  if (positions.length === 0) {
    tbody.append(el('tr', null, el('td', { colspan: 4, style: 'color:var(--text-dim);text-align:center;padding:12px;' }, 'データなし')));
  }

  // ----- Sessions list -----
  const list = $('#session-list');
  list.innerHTML = '';
  const sorted = [...filtered].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  if (sorted.length === 0) {
    list.append(el('div', { class: 'hint', style: 'text-align:center;padding:16px;' }, '記録されたセッションはまだありません'));
    return;
  }
  for (const s of sorted) {
    list.append(renderSessionCard(s));
  }
}

function renderSessionCard(s) {
  const st = statsOf(s.hands);
  const profit = (s.cashout || 0) - buyinTotal(s);
  const profitClass = profit > 0 ? 'profit-pos' : profit < 0 ? 'profit-neg' : '';
  const elapsed = sessionEffectiveMs(s);
  const hours = elapsed / 3600000;
  const hourly = hours > 0 ? profit / hours : 0;
  const bb100 = (st.total > 0 && s.blinds && s.blinds.bb > 0)
    ? (profit / s.blinds.bb * 100 / st.total).toFixed(1) : '—';

  const card = el('div', { class: 'session-item' });
  card.append(
    el('header', null,
      el('div', { class: 'si-title' }, `${s.venue || '(無名)'} ${s.blinds.sb}/${s.blinds.bb}`),
      el('div', { class: 'si-meta' }, `${fmtDate(s.startTime)} • ${s.tableSize}h ${s.category}`),
    ),
    el('div', { class: 'si-row' },
      el('span', null, `Hands: `, el('b', null, String(st.total))),
      el('span', null, `VPIP: `, el('b', null, Math.round(st.vpip * 100) + '%')),
      el('span', null, `PFR: `, el('b', null, Math.round(st.pfr * 100) + '%')),
      el('span', null, `3bet: `, el('b', null, Math.round(st.threebPct * 100) + '%')),
      el('span', null, `時間: `, el('b', null, fmtHours(elapsed))),
    ),
    el('div', { class: 'si-row' },
      el('span', null, `収支: `, el('b', { class: profitClass }, fmtMoney(profit))),
      el('span', null, `時給: `, el('b', { class: profitClass }, hours > 0 ? fmtMoney(hourly) + '/h' : '—')),
      el('span', null, `bb/100: `, el('b', { class: profitClass }, bb100)),
    ),
  );
  if (s.snapshots && s.snapshots.length > 1) {
    card.append(renderStackChart(s));
  }
  card.append(
    el('div', { class: 'si-actions' },
      el('button', { onclick: () => deleteSessionConfirm(s) , class: 'danger'}, '削除'),
    ),
  );
  return card;
}

function renderStackChart(s) {
  const W = 320, H = 70, P = 6;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('si-chart');

  // Build series: include initial buyin as starting point at hand 0,
  // each snapshot, and final cashout if present.
  const pts = [];
  const buyInitial = s.buyinInitial || 0;
  pts.push({ x: 0, y: buyInitial });
  // rebuys add to the implied stack baseline; show as gross stack (snapshot value).
  for (const sn of (s.snapshots || [])) pts.push({ x: sn.handIdx, y: sn.stack });
  if (s.cashout != null) pts.push({ x: s.hands.length, y: s.cashout });

  if (pts.length < 2) return el('div');

  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const spanY = (maxY - minY) || 1;
  const spanX = (maxX - minX) || 1;

  const scale = (x, y) => [
    P + (x - minX) / spanX * (W - 2 * P),
    H - P - (y - minY) / spanY * (H - 2 * P),
  ];

  // Zero (= initial buyin) reference line
  const baseY = scale(0, buyInitial)[1];
  const baseLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  baseLine.setAttribute('x1', 0); baseLine.setAttribute('x2', W);
  baseLine.setAttribute('y1', baseY); baseLine.setAttribute('y2', baseY);
  baseLine.setAttribute('stroke', '#475569');
  baseLine.setAttribute('stroke-dasharray', '3 3');
  baseLine.setAttribute('stroke-width', '1');
  svg.append(baseLine);

  // Line
  const d = pts.map((p, i) => {
    const [x, y] = scale(p.x, p.y);
    return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#38bdf8');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);

  // Dots
  for (const p of pts) {
    const [x, y] = scale(p.x, p.y);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 2.5);
    c.setAttribute('fill', '#38bdf8');
    svg.append(c);
  }
  return svg;
}

async function deleteSessionConfirm(s) {
  const ok = await confirmDialog('セッション削除', `${s.venue || '(無名)'} ${fmtDate(s.startTime)} を削除します。よろしいですか？`);
  if (!ok) return;
  await DB.deleteSession(s.id);
  toast('削除しました');
  renderRecordTab();
}

// =========================================================================
// Settings tab
// =========================================================================
async function applyDarkMode(enabled) {
  document.body.classList.toggle('light', !enabled);
  $('#theme-color-meta').setAttribute('content', enabled ? '#0f172a' : '#f8fafc');
  await DB.setSetting('darkMode', enabled);
}

async function initSettingsTab() {
  const dark = await DB.getSetting('darkMode', true);
  $('#set-dark').checked = !!dark;
  await applyDarkMode(!!dark);
  $('#set-dark').addEventListener('change', (e) => applyDarkMode(e.target.checked));

  const interval = await DB.getSetting('snapshotInterval', 50);
  state.snapshotIntervalDefault = interval;
  $('#set-snap-interval').value = interval;
  $('#set-snap-interval').addEventListener('change', async (e) => {
    const v = Math.max(0, Math.floor(parseFloat(e.target.value) || 0));
    state.snapshotIntervalDefault = v;
    await DB.setSetting('snapshotInterval', v);
    if (state.active) {
      state.active.snapshotInterval = v;
      await DB.putSession(state.active);
    }
    toast('保存しました');
  });

  $('#backup-export').addEventListener('click', backupExport);
  $('#backup-import').addEventListener('click', backupImport);
  $('#wipe-all').addEventListener('click', wipeAllConfirm);
}

async function backupExport() {
  const data = await DB.exportAll();
  const json = JSON.stringify(data, null, 2);
  const body = el('div', null,
    el('div', { class: 'hint', style: 'margin-bottom:6px;' }, 'コピーして安全な場所に貼り付けてください。'),
    el('textarea', { readonly: true }, json),
  );
  // try clipboard
  try {
    await navigator.clipboard.writeText(json);
    toast('クリップボードにコピーしました');
  } catch (e) { /* ignored */ }
  const ta = body.querySelector('textarea');
  setTimeout(() => { ta.focus(); ta.select(); }, 50);
  await modal({ title: 'バックアップ書き出し', bodyNode: body, hideCancel: true, okText: '閉じる' });
}

async function backupImport() {
  const ta = el('textarea', { placeholder: 'ここにバックアップJSONを貼り付け' });
  const merge = el('input', { type: 'checkbox' });
  const body = el('div', null,
    el('div', { class: 'hint', style: 'margin-bottom:6px;' }, '貼り付けてOKを押すと復元します。'),
    ta,
    el('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:8px;font-size:13px;color:var(--text-dim);' },
      merge, '既存データを残してマージ（OFFなら全置換）'),
  );
  const ok = await modal({ title: '復元', bodyNode: body });
  if (!ok) return;
  try {
    const obj = JSON.parse(ta.value);
    await DB.importAll(obj, { merge: merge.checked });
    toast('復元しました');
    // reload state
    state.active = await DB.findActiveSession();
    renderTopBar();
    renderSessionView();
    renderRecordTab();
  } catch (e) {
    toast('復元失敗: ' + e.message, 3000);
  }
}

async function wipeAllConfirm() {
  const ok = await confirmDialog('全データ削除', '本当に全データを消去しますか？ この操作は元に戻せません。');
  if (!ok) return;
  await DB.wipeAll();
  state.active = null;
  stopClock();
  toast('全データを削除しました');
  await applyDarkMode(true);
  state.snapshotIntervalDefault = 50;
  $('#set-snap-interval').value = 50;
  renderTopBar();
  renderSessionView();
  renderRecordTab();
}

// =========================================================================
// Tabs
// =========================================================================
function switchTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'record') renderRecordTab();
}

// =========================================================================
// Wire-up
// =========================================================================
async function init() {
  // tab buttons
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // start form
  $('#f-table-size').addEventListener('change', () => {
    $('#f-category').value = categoryFromTableSize(parseInt($('#f-table-size').value, 10));
    populateStartForm();
  });
  $('#start-session-form').addEventListener('submit', startSession);

  // action buttons
  $$('.act-btn').forEach(b => {
    b.addEventListener('click', () => recordAction(b.dataset.action));
  });
  $('#undo-btn').addEventListener('click', undoLastHand);
  $('#break-btn').addEventListener('click', toggleBreak);
  $('#rebuy-btn').addEventListener('click', doRebuy);
  $('#snapshot-btn').addEventListener('click', () => takeSnapshot({}));
  $('#end-session-btn').addEventListener('click', endSession);

  // position manual nav
  $('#pos-prev').addEventListener('click', async () => {
    const s = state.active; if (!s) return;
    s.currentPositionIdx = prevPositionIdx(s);
    await DB.putSession(s); renderSessionView();
  });
  $('#pos-next').addEventListener('click', async () => {
    const s = state.active; if (!s) return;
    s.currentPositionIdx = nextPositionIdx(s);
    await DB.putSession(s); renderSessionView();
  });

  // record filter
  $('#record-filter').addEventListener('change', (e) => {
    state.filter = e.target.value;
    renderRecordTab();
  });

  await initSettingsTab();

  // sync category to match initial table size
  $('#f-category').value = categoryFromTableSize(parseInt($('#f-table-size').value, 10));

  // restore active session if any
  state.active = await DB.findActiveSession();
  if (state.active) {
    // honor latest settings
    state.active.snapshotInterval = state.snapshotIntervalDefault;
    startClock();
  }
  populateStartForm();
  renderTopBar();
  renderSessionView();
  renderRecordTab();

  // recompute on tab visibility (sleeps)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderTopBar();
  });

  // register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
})();
