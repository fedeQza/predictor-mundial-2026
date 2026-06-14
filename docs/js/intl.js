// Capa de datos para la versión estática: carga el dataset de resultados (CSV) y los ratings
// (JSON) en el navegador, y calcula perfiles + H2H. Portado de server/intlResults.js.

import { config, DEFAULT_RATING, REFERENCE_RATING, getTier } from './config.js';
import { WORLD_CUP_TEAMS, getTeamName, repoNameToId } from './teams.js';

// --- CSV parser (mismo que server/dataset.js) -----------------------------------
function parseCsv(text) {
  const rows = [];
  let field = '', record = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { record.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.length > 1 || record[0] !== '') rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== '' || record.length) { record.push(field); rows.push(record); }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {}; header.forEach((h, idx) => { obj[h] = r[idx] ?? ''; }); return obj;
  });
}

// --- estado ---------------------------------------------------------------------
let rows = [];
let ratingsById = {};
let ratingsByName = {};

export async function loadData() {
  const [csv, ratings] = await Promise.all([
    fetch('data/international_results.csv').then((r) => r.text()),
    fetch('data/ratings.json').then((r) => r.json()),
  ]);
  rows = parseCsv(csv);
  ratingsById = ratings.byId || {};
  ratingsByName = ratings.byName || {};
}

// --- helpers --------------------------------------------------------------------
const num = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
function average(nums) {
  const v = nums.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0;
}
function opponentFactor(r) { return 1 + (r / REFERENCE_RATING - 1) * config.opponentWeight; }
const isPlayed = (r) => r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '' && r.away_score !== '';

function ratingForName(name) {
  const r = ratingsByName[name];
  if (typeof r === 'number') return r;
  return null;
}
function ratingByRepoName(name) {
  const elo = ratingForName(name);
  if (elo != null) return elo;
  return DEFAULT_RATING;
}
function qualityForId(id) {
  const r = ratingsById[String(id)] ?? ratingsById[Number(id)];
  if (typeof r !== 'number') return { rating: DEFAULT_RATING, ...getTier(DEFAULT_RATING) };
  const { tier, label } = getTier(r);
  return { rating: r, tier, tierLabel: label };
}

export function getTeamsList() {
  return WORLD_CUP_TEAMS.map((t) => {
    const q = qualityForId(t.id);
    return { id: t.id, name: t.name, conf: t.conf, rating: q.rating, tier: q.tier, tierLabel: q.tierLabel };
  });
}

export function getProfile(id) {
  const teamId = Number(id);
  const team = WORLD_CUP_TEAMS.find((t) => t.id === teamId);
  const mine = rows.filter((r) => repoNameToId(r.home) === teamId || repoNameToId(r.away) === teamId);
  if (mine.length === 0) return null;

  const played = mine.filter(isPlayed).sort((a, b) => (a.date < b.date ? 1 : -1));
  const recentRows = played.slice(0, config.recentMatches);

  const recent = [], adjGoalsFor = [], adjGoalsAgainst = [], formPointsArr = [];
  for (const r of recentRows) {
    const isHome = repoNameToId(r.home) === teamId;
    const gf = num(isHome ? r.home_score : r.away_score);
    const ga = num(isHome ? r.away_score : r.home_score);
    const opponent = isHome ? r.away : r.home;
    let result = 'D'; if (gf > ga) result = 'W'; else if (gf < ga) result = 'L';
    const oppRating = ratingByRepoName(opponent);
    const factor = opponentFactor(oppRating);
    adjGoalsFor.push(gf * factor);
    adjGoalsAgainst.push(ga / factor);
    formPointsArr.push(result === 'W' ? 3 : result === 'D' ? 1 : 0);
    recent.push({ result, goalsFor: gf, goalsAgainst: ga, opponent, opponentRating: oppRating, date: r.date });
  }
  const last5 = formPointsArr.slice(0, 5);
  const formPoints = last5.length ? average(last5) / 3 : 0.5;

  const upcoming = mine.filter((r) => !isPlayed(r)).sort((a, b) => (a.date < b.date ? -1 : 1));
  let nextFixture = null;
  const nx = upcoming[0];
  if (nx) {
    const isHome = repoNameToId(nx.home) === teamId;
    nextFixture = { date: nx.date, opponent: isHome ? nx.away : nx.home };
  }

  const q = qualityForId(teamId);
  return {
    id: teamId, name: team?.name || getTeamName(teamId),
    avgGoalsFor: average(adjGoalsFor), avgGoalsAgainst: average(adjGoalsAgainst),
    formPoints, recent: recent.slice(0, 10),
    stats: { shots_on_goal: 0, total_shots: 0, corners: 0, fouls: 0, cards: 0 },
    latestDate: recentRows[0]?.date || null, nextFixture, dataSource: 'intl-results',
    rating: q.rating, tier: q.tier, tierLabel: q.tierLabel,
  };
}

export function getH2H(profileA, profileB) {
  const idA = Number(profileA.id), idB = Number(profileB.id);
  const h2h = rows.filter((r) => {
    if (!isPlayed(r)) return false;
    const h = repoNameToId(r.home), a = repoNameToId(r.away);
    return (h === idA && a === idB) || (h === idB && a === idA);
  }).sort((x, y) => (x.date < y.date ? 1 : -1));

  const goalsA = [], goalsB = [], matches = [];
  for (const r of h2h) {
    const aIsHome = repoNameToId(r.home) === idA;
    const ga = num(aIsHome ? r.home_score : r.away_score);
    const gb = num(aIsHome ? r.away_score : r.home_score);
    goalsA.push(ga); goalsB.push(gb);
    matches.push({ date: r.date, teamA: profileA.name, teamB: profileB.name, goalsA: ga, goalsB: gb });
  }
  return { count: matches.length, avgGoalsA: average(goalsA), avgGoalsB: average(goalsB), matches: matches.slice(0, 6) };
}
