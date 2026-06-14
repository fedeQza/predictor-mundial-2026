// Frontend: llama a la API interna y renderiza los resultados.

const $ = (id) => document.getElementById(id);

const state = { demoMode: false, teams: [], prediction: null, selectedMetric: 'all', enriched: false };

// --- inicializacion -------------------------------------------------------------

async function init() {
  try {
    const health = await fetch('/api/health').then((r) => r.json());
    state.demoMode = health.demoMode;
    if (health.demoMode) $('demoBanner').classList.remove('hidden');
    populateMetrics(health.metrics);
  } catch {
    showStatus('No se pudo conectar con el servidor.', true);
  }

  await loadTeams();
  $('calcBtn').addEventListener('click', onCalculate);
  $('enrichBtn').addEventListener('click', onEnrich);
}

const METRIC_LABELS = {
  goals: 'Goles',
  cards: 'Tarjetas',
  shots_on_goal: 'Tiros al arco',
  total_shots: 'Tiros totales',
  corners: 'Córners',
  fouls: 'Faltas',
};

// Confederaciones para agrupar el desplegable de equipos.
const CONF_ORDER = ['UEFA', 'CONMEBOL', 'CAF', 'AFC', 'CONCACAF', 'OFC', 'Repechaje'];

async function loadTeams() {
  try {
    const { teams } = await fetch('/api/teams').then((r) => r.json());
    state.teams = teams || [];
    fillTeamSelect('teamA', state.teams);
    fillTeamSelect('teamB', state.teams);
    // Arranca con dos equipos distintos por comodidad.
    if (state.teams.length > 1) {
      $('teamA').value = state.teams[0].id;
      $('teamB').value = state.teams[1].id;
    }
  } catch {
    showStatus('No se pudieron cargar los equipos.', true);
  }
}

function fillTeamSelect(id, teams) {
  const sel = $(id);
  sel.innerHTML = '';
  // Agrupa por confederacion con <optgroup>.
  const byConf = {};
  teams.forEach((t) => {
    const c = t.conf || 'Otros';
    (byConf[c] = byConf[c] || []).push(t);
  });
  const confs = CONF_ORDER.filter((c) => byConf[c]).concat(
    Object.keys(byConf).filter((c) => !CONF_ORDER.includes(c))
  );
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
  // Opcion "Ver todos los datos" primero.
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = '★ Ver todos los datos';
  sel.appendChild(all);
  (metrics || Object.keys(METRIC_LABELS)).forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = METRIC_LABELS[m] || m;
    sel.appendChild(opt);
  });
}

// --- calculo --------------------------------------------------------------------

async function onCalculate() {
  const teamA = $('teamA').value;
  const teamB = $('teamB').value;
  const metric = $('metric').value;

  if (!teamA || !teamB) {
    showStatus('Elegí los dos equipos.', true);
    return;
  }
  if (teamA === teamB) {
    showStatus('Elegí dos equipos distintos.', true);
    return;
  }

  state.enriched = false;
  $('calcBtn').disabled = true;
  const waitMsg = state.demoMode
    ? 'Calculando…'
    : 'Calculando… (con datos reales la primera vez puede tardar ~1 min por el límite de la API)';
  showStatus(waitMsg, false);
  $('results').classList.add('hidden');

  try {
    // El backend siempre calcula todas las metricas; pasamos la elegida igual.
    const url = `/api/predict?teamA=${encodeURIComponent(teamA)}&teamB=${encodeURIComponent(teamB)}&metric=${encodeURIComponent(metric === 'all' ? 'goals' : metric)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en el servidor.');
    render(data.prediction, metric);
    hideStatus();
  } catch (err) {
    showStatus(err.message, true);
  } finally {
    $('calcBtn').disabled = false;
  }
}

// --- render ---------------------------------------------------------------------

function render(p, selectedMetric) {
  state.prediction = p;
  state.selectedMetric = selectedMetric;
  const nameA = p.teams.a.name;
  const nameB = p.teams.b.name;

  // Resultado
  $('matchTitle').textContent = `${nameA} vs ${nameB}`;
  renderQuality(p.teams.a, p.teams.b);
  $('labelA').textContent = `Gana ${nameA}`;
  $('labelB').textContent = `Gana ${nameB}`;
  setBar('barA', 'valA', p.goals.outcome.winA);
  setBar('barDraw', 'valDraw', p.goals.outcome.draw);
  setBar('barB', 'valB', p.goals.outcome.winB);
  $('xgA').textContent = p.goals.lambdaA;
  $('xgB').textContent = p.goals.lambdaB;
  $('btts').textContent = p.goals.bothTeamsScore + '%';

  const topScores = $('topScores');
  topScores.innerHTML = '';
  p.goals.topScores.forEach((s) => {
    const li = document.createElement('li');
    li.innerHTML = `${s.score} <strong>${s.prob}%</strong>`;
    topScores.appendChild(li);
  });

  // Panel(es) de métrica
  renderMetrics(p, selectedMetric, nameA, nameB);
  maybeShowEnrich(p, selectedMetric);

  // Forma reciente
  $('formAName').textContent = nameA;
  $('formBName').textContent = nameB;
  renderFreshness('freshA', p.teams.a);
  renderFreshness('freshB', p.teams.b);
  renderForm('formA', 'recentA', p.teams.a.recent);
  renderForm('formB', 'recentB', p.teams.b.recent);

  // H2H
  renderH2H(p.h2h, nameA, nameB);

  $('results').classList.remove('hidden');
}

function setBar(barId, valId, pctVal) {
  $(barId).style.width = pctVal + '%';
  $(valId).textContent = pctVal + '%';
}

function qualityBadge(team) {
  const tier = team.tier || 4;
  const label = team.tierLabel || '—';
  const rating = team.rating != null ? ` (${team.rating})` : '';
  return `<span class="tier-badge tier-${tier}">${team.name}: ${label}${rating}</span>`;
}

function renderQuality(a, b) {
  $('qualityRow').innerHTML = `
    <span class="muted">Calidad:</span>
    ${qualityBadge(a)}
    ${qualityBadge(b)}`;
}

function renderMetrics(p, selectedMetric, nameA, nameB) {
  const container = $('metricsContainer');
  container.innerHTML = '';

  const list = selectedMetric === 'all'
    ? p.allMetrics
    : [p.allMetrics.find((m) => m.key === selectedMetric) || p.metric];

  list.forEach((metric) => container.appendChild(buildMetricCard(metric, nameA, nameB)));
}

// Muestra la barra "Consultar API" si hay métricas de stats (no goles) sin datos en el dataset.
function maybeShowEnrich(p, selectedMetric) {
  const bar = $('enrichBar');
  if (state.enriched || selectedMetric === 'goals') {
    bar.classList.add('hidden');
    return;
  }
  const list = selectedMetric === 'all'
    ? p.allMetrics
    : p.allMetrics.filter((m) => m.key === selectedMetric);
  const needs = list.some((m) => m.key !== 'goals' && !m.available);
  bar.classList.toggle('hidden', !needs);
  if (needs) {
    $('enrichBtn').disabled = false;
    $('enrichNote').textContent = 'Tarjetas, tiros y córners no están en el dataset de resultados.';
  }
}

// Trae las stats detalladas desde la API y re-renderiza esos paneles.
async function onEnrich() {
  const p = state.prediction;
  if (!p) return;
  const a = p.teams.a.id;
  const b = p.teams.b.id;
  $('enrichBtn').disabled = true;
  $('enrichNote').textContent = 'Consultando la API… (puede tardar por el límite de la API)';
  try {
    const res = await fetch(`/api/enrich?teamA=${a}&teamB=${b}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo consultar la API.');
    const byKey = new Map((data.metrics || []).map((m) => [m.key, m]));
    p.allMetrics = p.allMetrics.map((m) => byKey.get(m.key) || m);
    if (p.metric && byKey.has(p.metric.key)) p.metric = byKey.get(p.metric.key);
    state.enriched = true;
    renderMetrics(p, state.selectedMetric, p.teams.a.name, p.teams.b.name);
    $('enrichBar').classList.add('hidden');
  } catch (err) {
    $('enrichNote').textContent = `API no disponible: ${err.message}`;
    $('enrichBtn').disabled = false;
  }
}

function buildMetricCard(metric, nameA, nameB) {
  const card = document.createElement('div');
  card.className = 'card metric-card';

  const linesHtml = (metric.available && metric.lines.length)
    ? metric.lines.map((l) => `
        <div class="metric-line">
          <span class="line-label">Más de ${l.line}</span>
          <span class="mini-bar">
            <span class="mini-over" style="width:${l.over}%"></span>
            <span class="mini-under" style="width:${l.under}%"></span>
          </span>
          <span class="line-vals">+${l.over}% / -${l.under}%</span>
        </div>`).join('')
    : '<p class="muted">Sin datos suficientes para esta métrica.</p>';

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

// Frescura de los datos: hasta qué fecha llegan y el próximo partido (si hay overlay 2026).
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
    li.innerHTML = `<span>${m.date} vs ${rival}</span><span>${m.goalsFor}-${m.goalsAgainst}</span>`;
    list.appendChild(li);
  });
}

function renderH2H(h2h, nameA, nameB) {
  const summary = $('h2hSummary');
  const list = $('h2hList');
  list.innerHTML = '';

  if (!h2h || h2h.count === 0) {
    summary.textContent = 'Sin enfrentamientos recientes registrados.';
    return;
  }
  summary.textContent = `${h2h.count} enfrentamientos · promedio de goles ${nameA} ${round(h2h.avgGoalsA)} – ${round(h2h.avgGoalsB)} ${nameB}`;
  (h2h.matches || []).forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${m.date}</span><span>${nameA} ${m.goalsA}-${m.goalsB} ${nameB}</span>`;
    list.appendChild(li);
  });
}

function round(n) { return Math.round(n * 10) / 10; }

// --- helpers de estado ----------------------------------------------------------

function showStatus(msg, isError) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.remove('hidden');
}
function hideStatus() { $('status').classList.add('hidden'); }

init();
