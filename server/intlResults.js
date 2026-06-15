// Proveedor PRIMARIO de datos: resultados de selecciones desde el dataset local
// data/international_results.csv (subconjunto de martj42/international_results, 2010+,
// equipos del Mundial). Cubre goles/forma/H2H/último-próximo partido SIN pegarle a la API.
// No trae stats detalladas (tarjetas/tiros/córners): eso queda para el botón "Consultar API".

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { WORLD_CUP_TEAMS } from './worldCupTeams.js';
import { getRating, getQuality, REFERENCE_RATING, DEFAULT_RATING } from './ratings.js';
import { ratingForName as eloByName, qualityForId as eloQualityForId } from './eloRatings.js';
import { DATA_DIR, parseCsv } from './dataset.js';

export const INTL_RESULTS_CSV = path.join(DATA_DIR, 'international_results.csv');
export const INTL_HEADER = ['date', 'home', 'away', 'home_score', 'away_score', 'tournament', 'neutral'];

// Nombres del repo que difieren de nuestro campo `en`.
const VARIANTS = {
  'United States': 'USA',
  'DR Congo': 'Congo DR',
  'Curaçao': 'Curacao',
  'Türkiye': 'Turkey',
};
const enToId = new Map(WORLD_CUP_TEAMS.map((t) => [t.en, t.id]));

// Nombre del repo -> id de nuestra lista (o null si no es mundialista).
export function repoNameToId(name) {
  if (!name) return null;
  const en = VARIANTS[name] || name;
  return enToId.has(en) ? enToId.get(en) : null;
}

// --- carga perezosa --------------------------------------------------------------
let loaded = false;
let rows = [];

function loadIntl() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(INTL_RESULTS_CSV)) {
      rows = parseCsv(fs.readFileSync(INTL_RESULTS_CSV, 'utf8'));
    }
  } catch (err) {
    console.warn('[intlResults] no se pudo cargar el CSV:', err.message);
    rows = [];
  }
}

export function hasData() {
  loadIntl();
  return rows.length > 0;
}

export function hasIntlTeam(id) {
  loadIntl();
  const teamId = Number(id);
  return rows.some((r) => repoNameToId(r.home) === teamId || repoNameToId(r.away) === teamId);
}

// --- helpers --------------------------------------------------------------------
function average(nums) {
  const v = nums.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0;
}
function opponentFactor(opponentRating, opponentWeight) {
  return 1 + (opponentRating / REFERENCE_RATING - 1) * opponentWeight;
}
function ratingByRepoName(name) {
  // 1) rating data-driven (Elo) por nombre; 2) hand-tuned por id si es mundialista; 3) default.
  const elo = eloByName(name);
  if (elo != null) return elo;
  const id = repoNameToId(name);
  return id != null ? getRating(id) : DEFAULT_RATING;
}
const isPlayed = (r) => r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '' && r.away_score !== '';

// --- perfil --------------------------------------------------------------------
export function getIntlProfile(id, opponentWeight = config.opponentWeight, asOf = null) {
  loadIntl();
  const teamId = Number(id);
  const team = WORLD_CUP_TEAMS.find((t) => t.id === teamId);
  const mine = rows.filter((r) => repoNameToId(r.home) === teamId || repoNameToId(r.away) === teamId);
  if (mine.length === 0) return null;

  // asOf (para backtest): solo partidos ANTERIORES a esa fecha, sin fuga de datos.
  const played = mine
    .filter((r) => isPlayed(r) && (!asOf || r.date < asOf))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const recentRows = played.slice(0, config.recentMatches);

  const recent = [];
  const adjGoalsFor = [];
  const adjGoalsAgainst = [];
  const formPointsArr = [];

  for (const r of recentRows) {
    const isHome = repoNameToId(r.home) === teamId;
    const gf = Number(isHome ? r.home_score : r.away_score);
    const ga = Number(isHome ? r.away_score : r.home_score);
    const opponent = isHome ? r.away : r.home;
    let result = 'D';
    if (gf > ga) result = 'W';
    else if (gf < ga) result = 'L';

    const oppRating = ratingByRepoName(opponent);
    const factor = opponentFactor(oppRating, opponentWeight);
    adjGoalsFor.push(gf * factor);
    adjGoalsAgainst.push(ga / factor);
    formPointsArr.push(result === 'W' ? 3 : result === 'D' ? 1 : 0);
    recent.push({ result, goalsFor: gf, goalsAgainst: ga, opponent, opponentRating: oppRating, date: r.date });
  }

  const last5 = formPointsArr.slice(0, 5);
  const formPoints = last5.length ? average(last5) / 3 : 0.5;

  // Próximo partido: fila futura (NA) más próxima.
  const upcoming = mine
    .filter((r) => !isPlayed(r))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  let nextFixture = null;
  const nx = upcoming[0];
  if (nx) {
    const isHome = repoNameToId(nx.home) === teamId;
    nextFixture = { date: nx.date, opponent: isHome ? nx.away : nx.home };
  }

  return {
    id: teamId,
    name: team?.name || String(id),
    avgGoalsFor: average(adjGoalsFor),
    avgGoalsAgainst: average(adjGoalsAgainst),
    formPoints,
    recent: recent.slice(0, 10),
    // El repo no trae stats detalladas: quedan en 0 hasta que se use el botón "Consultar API".
    stats: { shots_on_goal: 0, total_shots: 0, corners: 0, fouls: 0, cards: 0 },
    latestDate: recentRows[0]?.date || null,
    nextFixture,
    dataSource: 'intl-results',
    // Calidad data-driven (Elo) si está; si no, la hand-tuned de ratings.js.
    ...(eloQualityForId(teamId) || getQuality(teamId)),
  };
}

// --- head-to-head ---------------------------------------------------------------
export function getIntlH2H(profileA, profileB, asOf = null) {
  loadIntl();
  const idA = Number(profileA.id);
  const idB = Number(profileB.id);

  const h2h = rows.filter((r) => {
    if (!isPlayed(r) || (asOf && r.date >= asOf)) return false;
    const h = repoNameToId(r.home); const a = repoNameToId(r.away);
    return (h === idA && a === idB) || (h === idB && a === idA);
  }).sort((x, y) => (x.date < y.date ? 1 : -1));

  const goalsA = [];
  const goalsB = [];
  const matches = [];
  for (const r of h2h) {
    const aIsHome = repoNameToId(r.home) === idA;
    const ga = Number(aIsHome ? r.home_score : r.away_score);
    const gb = Number(aIsHome ? r.away_score : r.home_score);
    goalsA.push(ga); goalsB.push(gb);
    matches.push({ date: r.date, teamA: profileA.name, teamB: profileB.name, goalsA: ga, goalsB: gb });
  }

  return {
    count: matches.length,
    avgGoalsA: average(goalsA),
    avgGoalsB: average(goalsB),
    matches: matches.slice(0, 6),
  };
}
