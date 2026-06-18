// Modelo predictivo: combina Poisson (fuerza de ataque/defensa) con ajustes heuristicos
// (forma reciente y head-to-head). Todo el calculo es puro (sin I/O).

import { config } from './config.js';
import { dcLambdasForIds, hasData as hasDcData } from './dcRatings.js';
import { marketProbsForIds, hasData as hasOddsData } from './odds.js';

const MAX_GOALS = 8; // tope de goles por equipo para la matriz Poisson

// --- utilidades de probabilidad -------------------------------------------------

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// P(X = k) para una Poisson de media lambda.
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// P(X >= k) para una Poisson de media lambda (acumulada complementaria).
function poissonProbAtLeast(k, lambda) {
  let below = 0;
  for (let i = 0; i < k; i++) below += poissonPmf(i, lambda);
  return Math.max(0, 1 - below);
}

function round(n, d = 1) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function pct(n) {
  return round(n * 100, 1);
}

// --- ajustes heuristicos --------------------------------------------------------

// Devuelve un multiplicador alrededor de 1 a partir de la forma reciente del equipo.
// formPoints va de 0 (perdio todo) a 1 (gano todo); 0.5 es neutral.
function formMultiplier(formPoints, formWeight) {
  // Con FORM_WEIGHT=0.25, un equipo en racha perfecta multiplica ~1.25, uno hundido ~0.75.
  return 1 + (formPoints - 0.5) * 2 * formWeight;
}

// Sesgo por head-to-head: compara los goles historicos del equipo contra ese rival
// con el baseline de la liga.
function h2hMultiplier(avgGoalsInH2H, sampleCount, h2hWeight) {
  if (!sampleCount || sampleCount < 2) return 1; // muestra insuficiente -> sin ajuste
  const ratio = avgGoalsInH2H / config.leagueAverageGoals;
  // limitar el efecto para no distorsionar con muestras chicas
  const clamped = Math.max(0.5, Math.min(1.5, ratio));
  return 1 + (clamped - 1) * h2hWeight;
}

// --- prediccion de goles (resultado del partido) --------------------------------

function computeGoalLambdas(teamA, teamB, h2h, w = {}) {
  // Modelo Dixon-Coles (ataque/defensa por MLE): si esta disponible, los goles esperados salen de
  // las fuerzas de equipo ajustadas, sin la pila heuristica (forma/H2H/ratio de Elo). Validado por
  // backtest: baja el log-loss y reparte mejor favoritos/empates. La correccion DC (rho) y la
  // temperatura se aplican igual despues, en summarizeGoals.
  if ((w.useDcModel ?? config.useDcModel) && hasDcData()) {
    const dc = dcLambdasForIds(teamA.id, teamB.id);
    if (dc) {
      const lambdaA = Math.max(0.2, Math.min(5, dc.lambdaA));
      const lambdaB = Math.max(0.2, Math.min(5, dc.lambdaB));
      return { lambdaA, lambdaB };
    }
  }

  const formWeight = w.formWeight ?? config.formWeight;
  const h2hWeight = w.h2hWeight ?? config.h2hWeight;
  const ratingWeight = w.ratingWeight ?? config.ratingWeight;

  // Base: ataque de uno + defensa del otro, anclado al promedio de liga.
  let lambdaA = (teamA.avgGoalsFor + teamB.avgGoalsAgainst) / 2;
  let lambdaB = (teamB.avgGoalsFor + teamA.avgGoalsAgainst) / 2;

  // Mezcla con el baseline para amortiguar muestras chicas (shrinkage suave).
  lambdaA = 0.8 * lambdaA + 0.2 * config.leagueAverageGoals;
  lambdaB = 0.8 * lambdaB + 0.2 * config.leagueAverageGoals;

  // Ajuste por forma reciente.
  lambdaA *= formMultiplier(teamA.formPoints, formWeight);
  lambdaB *= formMultiplier(teamB.formPoints, formWeight);

  // Ajuste por head-to-head.
  if (h2h && h2h.count >= 2) {
    lambdaA *= h2hMultiplier(h2h.avgGoalsA, h2h.count, h2hWeight);
    lambdaB *= h2hMultiplier(h2h.avgGoalsB, h2h.count, h2hWeight);
  }

  // Peso directo de la calidad: si A tiene mejor rating que B, su lambda sube (y baja la de B).
  const ratingA = teamA.rating || 700;
  const ratingB = teamB.rating || 700;
  lambdaA *= 1 + (ratingA / ratingB - 1) * ratingWeight;
  lambdaB *= 1 + (ratingB / ratingA - 1) * ratingWeight;

  // Ventaja de local (0 en el Mundial por canchas neutrales).
  lambdaA *= 1 + config.homeAdvantage;

  // pisos/techos de sanidad
  lambdaA = Math.max(0.2, Math.min(5, lambdaA));
  lambdaB = Math.max(0.2, Math.min(5, lambdaB));

  return { lambdaA, lambdaB };
}

// Factor de correlacion Dixon-Coles para las 4 celdas de marcador bajo. rho<0 sube 0-0 y 1-1
// (empates) y baja 1-0 / 0-1, corrigiendo la subestimacion de empates del Poisson independiente.
function dcTau(a, b, lambdaA, lambdaB, rho) {
  if (!rho) return 1;
  let t = 1;
  if (a === 0 && b === 0) t = 1 - lambdaA * lambdaB * rho;
  else if (a === 0 && b === 1) t = 1 + lambdaA * rho;
  else if (a === 1 && b === 0) t = 1 + lambdaB * rho;
  else if (a === 1 && b === 1) t = 1 - rho;
  return Math.max(0, t);
}

function summarizeGoals(teamA, teamB, h2h, w = {}) {
  const { lambdaA, lambdaB } = computeGoalLambdas(teamA, teamB, h2h, w);
  const rho = w.dcRho ?? config.dcRho ?? 0;

  let pWinA = 0, pDraw = 0, pWinB = 0;
  let pBtts = 0;
  let Z = 0; // suma total tras aplicar Dixon-Coles (para renormalizar)
  const overUnder = { 1.5: 0, 2.5: 0, 3.5: 0 };
  const scorelines = [];

  for (let a = 0; a <= MAX_GOALS; a++) {
    for (let b = 0; b <= MAX_GOALS; b++) {
      const p = poissonPmf(a, lambdaA) * poissonPmf(b, lambdaB) * dcTau(a, b, lambdaA, lambdaB, rho);
      Z += p;
      if (a > b) pWinA += p;
      else if (a < b) pWinB += p;
      else pDraw += p;

      if (a > 0 && b > 0) pBtts += p;

      const total = a + b;
      if (total > 1.5) overUnder[1.5] += p;
      if (total > 2.5) overUnder[2.5] += p;
      if (total > 3.5) overUnder[3.5] += p;

      scorelines.push({ a, b, p });
    }
  }

  // Renormalizar: Dixon-Coles altera la masa de las 4 celdas, asi que dividimos por Z.
  const norm = Z > 0 ? 1 / Z : 1;
  pWinA *= norm; pDraw *= norm; pWinB *= norm; pBtts *= norm;
  overUnder[1.5] *= norm; overUnder[2.5] *= norm; overUnder[3.5] *= norm;

  // Calibracion por temperatura del 3-way W/D/L (no toca BTTS/over-under/marcadores).
  const T = w.probTemp ?? config.probTemp ?? 1;
  if (T !== 1 && T > 0) {
    const qa = pWinA ** (1 / T), qd = pDraw ** (1 / T), qb = pWinB ** (1 / T);
    const qs = qa + qd + qb;
    if (qs > 0) { pWinA = qa / qs; pDraw = qd / qs; pWinB = qb / qs; }
  }

  // Blend con cuotas del mercado (1X2), si hay snapshot para este cruce. Las cuotas son el predictor
  // mejor calibrado; mezclamos SOLO el resultado (no toca marcadores/BTTS/over-under). Offline.
  let market = null;
  if ((w.useOdds ?? config.useOdds) && hasOddsData()) {
    const m = marketProbsForIds(teamA.id, teamB.id);
    if (m) {
      const k = Math.max(0, Math.min(1, w.oddsWeight ?? config.oddsWeight ?? 0));
      pWinA = (1 - k) * pWinA + k * m.winA;
      pDraw = (1 - k) * pDraw + k * m.draw;
      pWinB = (1 - k) * pWinB + k * m.winB;
      const s = pWinA + pDraw + pWinB;
      if (s > 0) { pWinA /= s; pDraw /= s; pWinB /= s; }
      market = { weight: k, nBooks: m.nBooks, date: m.date };
    }
  }

  scorelines.sort((x, y) => y.p - x.p);
  const topScores = scorelines.slice(0, 5).map((s) => ({
    score: `${s.a}-${s.b}`,
    prob: pct(s.p * norm),
  }));

  return {
    lambdaA: round(lambdaA, 2),
    lambdaB: round(lambdaB, 2),
    outcome: {
      winA: pct(pWinA),
      draw: pct(pDraw),
      winB: pct(pWinB),
    },
    topScores,
    bothTeamsScore: pct(pBtts),
    overUnder: {
      '1.5': { over: pct(overUnder[1.5]), under: pct(1 - overUnder[1.5]) },
      '2.5': { over: pct(overUnder[2.5]), under: pct(1 - overUnder[2.5]) },
      '3.5': { over: pct(overUnder[3.5]), under: pct(1 - overUnder[3.5]) },
    },
    expectedTotal: round(lambdaA + lambdaB, 2),
    market, // null o { weight, nBooks, date } si se mezcló con cuotas del mercado
  };
}

// --- prediccion de metricas tipo conteo (tarjetas, tiros, etc) ------------------

// Para cada metrica usamos los promedios por partido de cada equipo.
// El total esperado se modela como Poisson para dar lineas Over/Under.
const METRIC_LABELS = {
  goals: 'Goles',
  cards: 'Tarjetas',
  shots_on_goal: 'Tiros al arco',
  total_shots: 'Tiros totales',
  corners: 'Corners',
  fouls: 'Faltas',
};

export const SUPPORTED_METRICS = Object.keys(METRIC_LABELS);

// Genera lineas Over/Under sensatas alrededor del total esperado (en pasos de 0.5).
function buildLines(expectedTotal) {
  const center = Math.round(expectedTotal); // entero mas cercano
  const candidates = [center - 1.5, center - 0.5, center + 0.5, center + 1.5]
    .filter((l) => l > 0);
  return candidates.map((line) => ({
    line,
    over: pct(poissonProbAtLeast(Math.ceil(line), expectedTotal)),
    under: pct(1 - poissonProbAtLeast(Math.ceil(line), expectedTotal)),
  }));
}

function summarizeMetric(metric, teamA, teamB) {
  const rawA = teamA.stats?.[metric];
  const rawB = teamB.stats?.[metric];
  const hasA = typeof rawA === 'number';
  const hasB = typeof rawB === 'number';
  // La metrica solo tiene sentido si AMBOS equipos tienen el dato (el total esperado
  // mezcla los dos). Si la API no cubre uno (p.ej. tiros de Senegal en eliminatorias CAF),
  // se marca "sin datos" y se nombra el lado que falta, en vez de inventar un 0.
  const available = hasA && hasB && (rawA + rawB) > 0;
  const expectedTotal = available ? rawA + rawB : null;
  const missing = [];
  if (!hasA) missing.push('a');
  if (!hasB) missing.push('b');

  return {
    key: metric,
    label: METRIC_LABELS[metric],
    perTeam: {
      a: hasA ? round(rawA, 2) : null,
      b: hasB ? round(rawB, 2) : null,
    },
    expectedTotal: expectedTotal == null ? null : round(expectedTotal, 2),
    lines: available ? buildLines(expectedTotal) : [],
    available,
    missing: missing.length ? missing : undefined,
  };
}

// --- API publica del modelo -----------------------------------------------------

/**
 * Construye la prediccion completa.
 * @param {object} teamA  perfil del equipo A (ver dataService)
 * @param {object} teamB  perfil del equipo B
 * @param {object} h2h    head-to-head { count, avgGoalsA, avgGoalsB, matches }
 * @param {string} metric metrica elegida para el panel de detalle
 */
function goalsAsMetric(goals) {
  return {
    key: 'goals',
    label: METRIC_LABELS.goals,
    perTeam: { a: goals.lambdaA, b: goals.lambdaB },
    expectedTotal: goals.expectedTotal,
    lines: [
      { line: 1.5, ...goals.overUnder['1.5'] },
      { line: 2.5, ...goals.overUnder['2.5'] },
      { line: 3.5, ...goals.overUnder['3.5'] },
    ],
    available: true,
  };
}

// Detalle de una metrica cualquiera (goals usa los lambdas; el resto, los promedios).
function metricDetailFor(key, goals, teamA, teamB) {
  if (key === 'goals') return goalsAsMetric(goals);
  return summarizeMetric(key, teamA, teamB);
}

export function predict(teamA, teamB, h2h, metric = 'goals', weights = {}) {
  const goals = summarizeGoals(teamA, teamB, h2h, weights);

  const selected = SUPPORTED_METRICS.includes(metric) ? metric : 'goals';
  const metricDetail = metricDetailFor(selected, goals, teamA, teamB);

  // Todas las metricas calculadas, para la opcion "Ver todos los datos".
  const allMetrics = SUPPORTED_METRICS.map((m) => metricDetailFor(m, goals, teamA, teamB));

  return {
    teams: {
      a: { id: teamA.id, name: teamA.name, formPoints: round(teamA.formPoints, 2), recent: teamA.recent, rating: teamA.rating, tier: teamA.tier, tierLabel: teamA.tierLabel, latestDate: teamA.latestDate, nextFixture: teamA.nextFixture, dataSource: teamA.dataSource },
      b: { id: teamB.id, name: teamB.name, formPoints: round(teamB.formPoints, 2), recent: teamB.recent, rating: teamB.rating, tier: teamB.tier, tierLabel: teamB.tierLabel, latestDate: teamB.latestDate, nextFixture: teamB.nextFixture, dataSource: teamB.dataSource },
    },
    goals,
    metric: metricDetail,
    allMetrics,
    h2h: h2h || { count: 0, matches: [] },
    metricsAvailable: SUPPORTED_METRICS.map((m) => ({ key: m, label: METRIC_LABELS[m] })),
  };
}
