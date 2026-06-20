// Frontend de la versión estática (GitHub Pages): todo el cálculo corre en el navegador.

import { loadData, getTeamsList, getProfile, getH2H } from './intl.js';
import { predict, SUPPORTED_METRICS } from './model.js';
import { config } from './config.js';

const $ = (id) => document.getElementById(id);
const state = { teams: [], prediction: null, selectedMetric: 'all' };

// Sliders de pesos: [idSlider, idValor, claveEnConfig]. Editan el modelo en vivo.
const WEIGHT_FIELDS = [
  ['wForm', 'vForm', 'formWeight'],
  ['wRating', 'vRating', 'ratingWeight'],
  ['wH2h', 'vH2h', 'h2hWeight'],
  ['wOpp', 'vOpp', 'opponentWeight'],
];
const DEFAULT_WEIGHTS = { formWeight: 0.05, ratingWeight: 0.90, h2hWeight: 0.20, opponentWeight: 1.00 };

const METRIC_LABELS = {
  goals: 'Goles', cards: 'Tarjetas', shots_on_goal: 'Tiros al arco',
  total_shots: 'Tiros totales', corners: 'Córners', fouls: 'Faltas',
};
const CONF_ORDER = ['UEFA', 'CONMEBOL', 'CAF', 'AFC', 'CONCACAF', 'OFC', 'Repechaje'];

async function init() {
  showStatus('Cargando datos…', false);
  try {
    await loadData();
  } catch (err) {
    showStatus('No se pudieron cargar los datos del dataset.', true);
    return;
  }
  populateMetrics(SUPPORTED_METRICS);
  loadTeams();
  setupModelMode();
  setupWeights();
  $('calcBtn').addEventListener('click', onCalculate);
  hideStatus();
}

// --- modo del modelo (avanzado=ataque/defensa | clasico=heuristico con sliders) -------------
function setupModelMode() {
  const saved = (() => { try { return localStorage.getItem('modelMode'); } catch { return null; } })();
  const mode = saved === 'clasico' ? 'clasico' : 'avanzado';
  applyModelMode(mode);
  document.querySelectorAll('input[name="modelMode"]').forEach((r) => {
    r.checked = r.value === mode;
    r.addEventListener('change', () => {
      if (!r.checked) return;
      applyModelMode(r.value);
      try { localStorage.setItem('modelMode', r.value); } catch { /* ignore */ }
      if (state.prediction) computeAndRender();
    });
  });
}

function applyModelMode(mode) {
  const classic = mode === 'clasico';
  config.useDcModel = !classic;
  $('classicControls').hidden = !classic;
  $('modeHint').hidden = classic;
}

// --- pesos del modelo (sliders) -------------------------------------------------
function applyWeights() {
  WEIGHT_FIELDS.forEach(([sliderId, valId, key]) => {
    const v = parseFloat($(sliderId).value);
    config[key] = v;
    $(valId).textContent = v.toFixed(2);
  });
  try {
    localStorage.setItem('weights', JSON.stringify({
      formWeight: config.formWeight, ratingWeight: config.ratingWeight,
      h2hWeight: config.h2hWeight, opponentWeight: config.opponentWeight,
    }));
  } catch { /* localStorage no disponible */ }
}

function setupWeights() {
  try {
    const saved = JSON.parse(localStorage.getItem('weights') || 'null');
    if (saved) WEIGHT_FIELDS.forEach(([sliderId, , key]) => { if (saved[key] != null) $(sliderId).value = saved[key]; });
  } catch { /* ignore */ }
  applyWeights();
  WEIGHT_FIELDS.forEach(([sliderId]) => $(sliderId).addEventListener('input', onWeightChange));
  $('resetWeights').addEventListener('click', () => {
    WEIGHT_FIELDS.forEach(([sliderId, , key]) => { $(sliderId).value = DEFAULT_WEIGHTS[key]; });
    onWeightChange();
  });
}

function onWeightChange() {
  applyWeights();
  if (state.prediction) computeAndRender(); // recalcula el matchup actual en vivo
}

function loadTeams() {
  state.teams = getTeamsList();
  fillTeamSelect('teamA', state.teams);
  fillTeamSelect('teamB', state.teams);
  if (state.teams.length > 1) {
    $('teamA').value = state.teams[0].id;
    $('teamB').value = state.teams[1].id;
  }
}

function fillTeamSelect(id, teams) {
  const sel = $(id);
  sel.innerHTML = '';
  const byConf = {};
  teams.forEach((t) => { const c = t.conf || 'Otros'; (byConf[c] = byConf[c] || []).push(t); });
  const confs = CONF_ORDER.filter((c) => byConf[c]).concat(Object.keys(byConf).filter((c) => !CONF_ORDER.includes(c)));
  confs.forEach((conf) => {
    const group = document.createElement('optgroup');
    group.label = conf;
    byConf[conf].forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.tierLabel ? `${t.name} · ${t.tierLabel}` : t.name;
      group.appendChild(opt);
    });
    sel.appendChild(group);
  });
}

function populateMetrics(metrics) {
  const sel = $('metric');
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = '★ Ver todos los datos';
  sel.appendChild(all);
  (metrics || Object.keys(METRIC_LABELS)).forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = METRIC_LABELS[m] || m;
    sel.appendChild(opt);
  });
}

function onCalculate() {
  const teamA = $('teamA').value;
  const teamB = $('teamB').value;
  if (!teamA || !teamB) { showStatus('Elegí los dos equipos.', true); return; }
  if (teamA === teamB) { showStatus('Elegí dos equipos distintos.', true); return; }
  computeAndRender();
}

// Calcula y renderiza el matchup actual con los pesos vigentes (usado por Calcular y por los sliders).
function computeAndRender() {
  const teamA = $('teamA').value;
  const teamB = $('teamB').value;
  const metric = $('metric').value;
  if (!teamA || !teamB || teamA === teamB) return;
  try {
    const profileA = getProfile(teamA);
    const profileB = getProfile(teamB);
    if (!profileA || !profileB) throw new Error('No hay datos para alguno de los equipos.');
    const h2h = getH2H(profileA, profileB);
    const result = predict(profileA, profileB, h2h, metric === 'all' ? 'goals' : metric);
    render(result, metric);
    hideStatus();
  } catch (err) {
    showStatus(err.message, true);
  }
}

function render(p, selectedMetric) {
  state.prediction = p;
  state.selectedMetric = selectedMetric;
  const nameA = p.teams.a.name;
  const nameB = p.teams.b.name;

  $('matchTitle').textContent = `${nameA} vs ${nameB}`;
  renderMarketNote(p.goals.market);
  renderQuality(p.teams.a, p.teams.b);
  $('labelA').textContent = `Gana ${nameA}`;
  $('labelB').textContent = `Gana ${nameB}`;
  setBar('barA', 'valA', p.goals.outcome.winA);
  setBar('barDraw', 'valDraw', p.goals.outcome.draw);
  setBar('barB', 'valB', p.goals.outcome.winB);
  $('xgA').textContent = p.goals.lambdaA;
  $('xgB').textContent = p.goals.lambdaB;
  $('btts').textContent = p.goals.bothTeamsScore + '%';

  renderScoreMatrix(p.goals.scoreMatrix, nameA, nameB);

  renderMetrics(p, selectedMetric, nameA, nameB);
  maybeShowStatsNote(p, selectedMetric);

  $('formAName').textContent = nameA;
  $('formBName').textContent = nameB;
  renderFreshness('freshA', p.teams.a);
  renderFreshness('freshB', p.teams.b);
  renderForm('formA', 'recentA', p.teams.a.recent);
  renderForm('formB', 'recentB', p.teams.b.recent);

  renderH2H(p.h2h, nameA, nameB);
  $('results').classList.remove('hidden');
}

function setBar(barId, valId, pctVal) { $(barId).style.width = pctVal + '%'; $(valId).textContent = pctVal + '%'; }

// Tabla heatmap de marcadores 0-4 (filas = goles de A, columnas = goles de B). Espejo de public/app.js.
const MX_COLORS = { a: [74, 158, 255], draw: [201, 162, 39], b: [255, 107, 107] };
function mxCell(tag, text, cls) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function renderScoreMatrix(matrix, nameA, nameB) {
  const host = $('scoreMatrix');
  if (!host) return;
  host.innerHTML = '';
  if (!matrix || !matrix.length) return;

  let max = 0, topA = 0, topB = 0;
  matrix.forEach((row, a) => row.forEach((v, b) => { if (v > max) { max = v; topA = a; topB = b; } }));

  const legend = document.createElement('p');
  legend.className = 'matrix-legend';
  legend.innerHTML = `Filas <span class="mx-key-a">${nameA}</span> ↓ · Columnas <span class="mx-key-b">${nameB}</span> →`;
  host.appendChild(legend);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.appendChild(mxCell('th', '', 'mx-corner'));
  for (let b = 0; b < matrix[0].length; b++) hr.appendChild(mxCell('th', b, 'mx-head mx-head-b'));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  matrix.forEach((row, a) => {
    const tr = document.createElement('tr');
    tr.appendChild(mxCell('th', a, 'mx-head mx-head-a'));
    row.forEach((v, b) => {
      const td = mxCell('td', v > 0 ? v.toFixed(1) + '%' : '·', 'mx-cell');
      const c = a > b ? MX_COLORS.a : a < b ? MX_COLORS.b : MX_COLORS.draw;
      const alpha = max > 0 ? 0.06 + 0.84 * (v / max) : 0;
      td.style.background = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
      td.title = `${nameA} ${a}-${b} ${nameB}: ${v}%`;
      if (a === topA && b === topB) td.classList.add('mx-top');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  host.appendChild(table);
}

function renderMarketNote(market) {
  const el = $('marketNote');
  if (!el) return;
  if (market) {
    el.textContent = `📊 Ajustado con cuotas del mercado (${Math.round(market.weight * 100)}% mercado · ${market.nBooks} casas)`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function qualityBadge(team) {
  const tier = team.tier || 4;
  const label = team.tierLabel || '—';
  const rating = team.rating != null ? ` (${team.rating})` : '';
  return `<span class="tier-badge tier-${tier}">${team.name}: ${label}${rating}</span>`;
}
function renderQuality(a, b) {
  $('qualityRow').innerHTML = `<span class="muted">Calidad:</span> ${qualityBadge(a)} ${qualityBadge(b)}`;
}

// En la versión web las stats detalladas no están: mostramos un aviso (no un botón).
function maybeShowStatsNote(p, selectedMetric) {
  const bar = $('enrichBar');
  if (selectedMetric === 'goals') { bar.classList.add('hidden'); return; }
  const list = selectedMetric === 'all' ? p.allMetrics : p.allMetrics.filter((m) => m.key === selectedMetric);
  const needs = list.some((m) => m.key !== 'goals' && !m.available);
  bar.classList.toggle('hidden', !needs);
}

function renderMetrics(p, selectedMetric, nameA, nameB) {
  const container = $('metricsContainer');
  container.innerHTML = '';
  const list = selectedMetric === 'all'
    ? p.allMetrics
    : [p.allMetrics.find((m) => m.key === selectedMetric) || p.metric];
  list.forEach((metric) => container.appendChild(buildMetricCard(metric, nameA, nameB)));
}

function buildMetricCard(metric, nameA, nameB) {
  const card = document.createElement('div');
  card.className = 'card metric-card';
  const linesHtml = (metric.available && metric.lines.length)
    ? metric.lines.map((l) => `
        <div class="metric-line">
          <span class="line-label">Más de ${l.line}</span>
          <span class="mini-bar"><span class="mini-over" style="width:${l.over}%"></span><span class="mini-under" style="width:${l.under}%"></span></span>
          <span class="line-vals">+${l.over}% / -${l.under}%</span>
        </div>`).join('')
    : '<p class="muted">No disponible en la versión web (cloná el repo para traerlo de la API).</p>';
  card.innerHTML = `
    <h2>${metric.label}</h2>
    <div class="metric-expected">
      <div class="metric-team"><span class="muted">${nameA}</span><strong>${metric.perTeam.a}</strong></div>
      <div class="metric-team"><span class="muted">${nameB}</span><strong>${metric.perTeam.b}</strong></div>
      <div class="metric-team total"><span class="muted">Total esperado</span><strong>${metric.expectedTotal}</strong></div>
    </div>
    <div class="metric-lines">${linesHtml}</div>`;
  return card;
}

function renderFreshness(elId, team) {
  const el = $(elId);
  const parts = [];
  if (team.latestDate) parts.push(`Datos al ${team.latestDate}`);
  if (team.nextFixture && team.nextFixture.opponent) {
    parts.push(`Próximo: vs ${team.nextFixture.opponent}${team.nextFixture.date ? ` (${team.nextFixture.date})` : ''}`);
  }
  el.textContent = parts.join(' · ');
  el.classList.toggle('hidden', parts.length === 0);
}

function renderForm(chipsId, listId, recent) {
  const chips = $(chipsId);
  const list = $(listId);
  chips.innerHTML = '';
  list.innerHTML = '';
  (recent || []).forEach((m) => {
    const chip = document.createElement('span');
    chip.className = 'chip chip-' + m.result;
    chip.textContent = m.result;
    chips.appendChild(chip);
    const rival = m.opponentRating != null ? `${m.opponent} (${m.opponentRating})` : m.opponent;
    const li = document.createElement('li');
    const isWc = m.tournament === 'FIFA World Cup'; // solo la fase final, no las eliminatorias
    if (isWc) li.className = 'recent-wc';
    const tag = isWc ? ' <span class="wc-tag">★ Mundial</span>' : '';
    li.innerHTML = `<span>${m.date} vs ${rival}${tag}</span><span>${m.goalsFor}-${m.goalsAgainst}</span>`;
    list.appendChild(li);
  });
}

function renderH2H(h2h, nameA, nameB) {
  const summary = $('h2hSummary');
  const list = $('h2hList');
  list.innerHTML = '';
  if (!h2h || h2h.count === 0) { summary.textContent = 'Sin enfrentamientos recientes registrados.'; return; }
  summary.textContent = `${h2h.count} enfrentamientos · promedio de goles ${nameA} ${round(h2h.avgGoalsA)} – ${round(h2h.avgGoalsB)} ${nameB}`;
  (h2h.matches || []).forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${m.date}</span><span>${nameA} ${m.goalsA}-${m.goalsB} ${nameB}</span>`;
    list.appendChild(li);
  });
}

function round(n) { return Math.round(n * 10) / 10; }

function showStatus(msg, isError) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.remove('hidden');
}
function hideStatus() { $('status').classList.add('hidden'); }

init();
