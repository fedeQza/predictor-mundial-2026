// Modelo predictivo (versión navegador): Poisson + ajustes heurísticos. Cálculo puro.
// Portado de server/model.js sin cambios de lógica.

import { config } from './config.js';

const MAX_GOALS = 8;

function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}
function poissonProbAtLeast(k, lambda) {
  let below = 0;
  for (let i = 0; i < k; i++) below += poissonPmf(i, lambda);
  return Math.max(0, 1 - below);
}
function round(n, d = 1) { const f = Math.pow(10, d); return Math.round(n * f) / f; }
function pct(n) { return round(n * 100, 1); }

function formMultiplier(formPoints) { return 1 + (formPoints - 0.5) * 2 * config.formWeight; }
function h2hMultiplier(avgGoalsInH2H, sampleCount) {
  if (!sampleCount || sampleCount < 2) return 1;
  const ratio = avgGoalsInH2H / config.leagueAverageGoals;
  const clamped = Math.max(0.5, Math.min(1.5, ratio));
  return 1 + (clamped - 1) * config.h2hWeight;
}

function computeGoalLambdas(teamA, teamB, h2h) {
  let lambdaA = (teamA.avgGoalsFor + teamB.avgGoalsAgainst) / 2;
  let lambdaB = (teamB.avgGoalsFor + teamA.avgGoalsAgainst) / 2;
  lambdaA = 0.8 * lambdaA + 0.2 * config.leagueAverageGoals;
  lambdaB = 0.8 * lambdaB + 0.2 * config.leagueAverageGoals;
  lambdaA *= formMultiplier(teamA.formPoints);
  lambdaB *= formMultiplier(teamB.formPoints);
  if (h2h && h2h.count >= 2) {
    lambdaA *= h2hMultiplier(h2h.avgGoalsA, h2h.count);
    lambdaB *= h2hMultiplier(h2h.avgGoalsB, h2h.count);
  }
  const ratingA = teamA.rating || 700;
  const ratingB = teamB.rating || 700;
  lambdaA *= 1 + (ratingA / ratingB - 1) * config.ratingWeight;
  lambdaB *= 1 + (ratingB / ratingA - 1) * config.ratingWeight;
  lambdaA *= 1 + config.homeAdvantage;
  lambdaA = Math.max(0.2, Math.min(5, lambdaA));
  lambdaB = Math.max(0.2, Math.min(5, lambdaB));
  return { lambdaA, lambdaB };
}

// Factor de correlacion Dixon-Coles (corrige empates/marcadores bajos). rho<0 sube 0-0 y 1-1.
function dcTau(a, b, lambdaA, lambdaB, rho) {
  if (!rho) return 1;
  let t = 1;
  if (a === 0 && b === 0) t = 1 - lambdaA * lambdaB * rho;
  else if (a === 0 && b === 1) t = 1 + lambdaA * rho;
  else if (a === 1 && b === 0) t = 1 + lambdaB * rho;
  else if (a === 1 && b === 1) t = 1 - rho;
  return Math.max(0, t);
}

function summarizeGoals(teamA, teamB, h2h) {
  const { lambdaA, lambdaB } = computeGoalLambdas(teamA, teamB, h2h);
  const rho = config.dcRho ?? 0;
  let pWinA = 0, pDraw = 0, pWinB = 0, pBtts = 0, Z = 0;
  const overUnder = { 1.5: 0, 2.5: 0, 3.5: 0 };
  const scorelines = [];
  for (let a = 0; a <= MAX_GOALS; a++) {
    for (let b = 0; b <= MAX_GOALS; b++) {
      const p = poissonPmf(a, lambdaA) * poissonPmf(b, lambdaB) * dcTau(a, b, lambdaA, lambdaB, rho);
      Z += p;
      if (a > b) pWinA += p; else if (a < b) pWinB += p; else pDraw += p;
      if (a > 0 && b > 0) pBtts += p;
      const total = a + b;
      if (total > 1.5) overUnder[1.5] += p;
      if (total > 2.5) overUnder[2.5] += p;
      if (total > 3.5) overUnder[3.5] += p;
      scorelines.push({ a, b, p });
    }
  }
  const norm = Z > 0 ? 1 / Z : 1;
  pWinA *= norm; pDraw *= norm; pWinB *= norm; pBtts *= norm;
  overUnder[1.5] *= norm; overUnder[2.5] *= norm; overUnder[3.5] *= norm;
  scorelines.sort((x, y) => y.p - x.p);
  const topScores = scorelines.slice(0, 5).map((s) => ({ score: `${s.a}-${s.b}`, prob: pct(s.p * norm) }));
  return {
    lambdaA: round(lambdaA, 2), lambdaB: round(lambdaB, 2),
    outcome: { winA: pct(pWinA), draw: pct(pDraw), winB: pct(pWinB) },
    topScores, bothTeamsScore: pct(pBtts),
    overUnder: {
      '1.5': { over: pct(overUnder[1.5]), under: pct(1 - overUnder[1.5]) },
      '2.5': { over: pct(overUnder[2.5]), under: pct(1 - overUnder[2.5]) },
      '3.5': { over: pct(overUnder[3.5]), under: pct(1 - overUnder[3.5]) },
    },
    expectedTotal: round(lambdaA + lambdaB, 2),
  };
}

const METRIC_LABELS = {
  goals: 'Goles', cards: 'Tarjetas', shots_on_goal: 'Tiros al arco',
  total_shots: 'Tiros totales', corners: 'Corners', fouls: 'Faltas',
};
export const SUPPORTED_METRICS = Object.keys(METRIC_LABELS);

function buildLines(expectedTotal) {
  const center = Math.round(expectedTotal);
  const candidates = [center - 1.5, center - 0.5, center + 0.5, center + 1.5].filter((l) => l > 0);
  return candidates.map((line) => ({
    line,
    over: pct(poissonProbAtLeast(Math.ceil(line), expectedTotal)),
    under: pct(1 - poissonProbAtLeast(Math.ceil(line), expectedTotal)),
  }));
}

function summarizeMetric(metric, teamA, teamB) {
  const avgA = teamA.stats?.[metric] ?? 0;
  const avgB = teamB.stats?.[metric] ?? 0;
  const expectedTotal = avgA + avgB;
  return {
    key: metric, label: METRIC_LABELS[metric],
    perTeam: { a: round(avgA, 2), b: round(avgB, 2) },
    expectedTotal: round(expectedTotal, 2),
    lines: expectedTotal > 0 ? buildLines(expectedTotal) : [],
    available: expectedTotal > 0,
  };
}

function goalsAsMetric(goals) {
  return {
    key: 'goals', label: METRIC_LABELS.goals,
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

function metricDetailFor(key, goals, teamA, teamB) {
  if (key === 'goals') return goalsAsMetric(goals);
  return summarizeMetric(key, teamA, teamB);
}

export function predict(teamA, teamB, h2h, metric = 'goals') {
  const goals = summarizeGoals(teamA, teamB, h2h);
  const selected = SUPPORTED_METRICS.includes(metric) ? metric : 'goals';
  const metricDetail = metricDetailFor(selected, goals, teamA, teamB);
  const allMetrics = SUPPORTED_METRICS.map((m) => metricDetailFor(m, goals, teamA, teamB));
  return {
    teams: {
      a: { id: teamA.id, name: teamA.name, formPoints: round(teamA.formPoints, 2), recent: teamA.recent, rating: teamA.rating, tier: teamA.tier, tierLabel: teamA.tierLabel, latestDate: teamA.latestDate, nextFixture: teamA.nextFixture, dataSource: teamA.dataSource },
      b: { id: teamB.id, name: teamB.name, formPoints: round(teamB.formPoints, 2), recent: teamB.recent, rating: teamB.rating, tier: teamB.tier, tierLabel: teamB.tierLabel, latestDate: teamB.latestDate, nextFixture: teamB.nextFixture, dataSource: teamB.dataSource },
    },
    goals, metric: metricDetail, allMetrics,
    h2h: h2h || { count: 0, matches: [] },
    metricsAvailable: SUPPORTED_METRICS.map((m) => ({ key: m, label: METRIC_LABELS[m] })),
  };
}
