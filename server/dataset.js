// Dataset local (CSV): permite que la app consuma los perfiles de los 48 equipos desde
// data/teams.csv + data/matches.csv, sin pegarle a API-Football en cada consulta.
// Este modulo es la "fuente de verdad" del esquema CSV (lo reusan el loader y el builder)
// y expone helpers de lectura para dataService.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const TEAMS_CSV = path.join(DATA_DIR, 'teams.csv');
export const MATCHES_CSV = path.join(DATA_DIR, 'matches.csv');

// Esquema de columnas (orden fijo).
export const TEAMS_HEADER = [
  'id', 'name', 'en', 'conf', 'rating', 'tier', 'tierLabel',
  'avgGoalsFor', 'avgGoalsAgainst', 'formPoints',
  'shots_on_goal', 'total_shots', 'corners', 'fouls', 'cards',
  'latestDate', 'nextDate', 'nextOpponent', 'dataSource',
];
export const MATCHES_HEADER = [
  'teamId', 'date', 'opponent', 'opponentRating', 'goalsFor', 'goalsAgainst', 'result',
];

// --- CSV minimo (sin dependencias) ----------------------------------------------
export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(header, rows) {
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

// Parser tolerante: comillas dobles, "" como comilla escapada, saltos \n y \r\n.
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
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
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return obj;
  });
}

// --- carga perezosa --------------------------------------------------------------
let loaded = false;
let teamsById = new Map();        // id -> fila de teams.csv
let matchesByTeam = new Map();    // id -> array de filas de matches.csv (orden del archivo)

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadDataset() {
  if (loaded) return;
  loaded = true;
  teamsById = new Map();
  matchesByTeam = new Map();
  try {
    if (fs.existsSync(TEAMS_CSV)) {
      for (const row of parseCsv(fs.readFileSync(TEAMS_CSV, 'utf8'))) {
        teamsById.set(num(row.id), row);
      }
    }
    if (fs.existsSync(MATCHES_CSV)) {
      for (const row of parseCsv(fs.readFileSync(MATCHES_CSV, 'utf8'))) {
        const id = num(row.teamId);
        if (!matchesByTeam.has(id)) matchesByTeam.set(id, []);
        matchesByTeam.get(id).push(row);
      }
    }
  } catch (err) {
    console.warn('[dataset] no se pudo cargar el CSV:', err.message);
  }
}

export function datasetSize() {
  loadDataset();
  return teamsById.size;
}

export function hasDatasetTeam(id) {
  loadDataset();
  return teamsById.has(Number(id));
}

function recentForTeam(id) {
  return (matchesByTeam.get(Number(id)) || []).map((m) => ({
    result: m.result,
    goalsFor: num(m.goalsFor),
    goalsAgainst: num(m.goalsAgainst),
    opponent: m.opponent,
    opponentRating: num(m.opponentRating),
    date: m.date,
  }));
}

// Reconstruye el perfil con la MISMA forma que devuelve dataService.getTeamProfile.
export function getDatasetProfile(id) {
  loadDataset();
  const t = teamsById.get(Number(id));
  if (!t) return null;
  const recent = recentForTeam(id);
  const nextFixture = (t.nextOpponent && t.nextDate)
    ? { date: t.nextDate, opponent: t.nextOpponent }
    : null;
  return {
    id: Number(t.id),
    name: t.name,
    avgGoalsFor: num(t.avgGoalsFor),
    avgGoalsAgainst: num(t.avgGoalsAgainst),
    formPoints: num(t.formPoints, 0.5),
    recent: recent.slice(0, 10),
    stats: {
      shots_on_goal: num(t.shots_on_goal),
      total_shots: num(t.total_shots),
      corners: num(t.corners),
      fouls: num(t.fouls),
      cards: num(t.cards),
    },
    rating: num(t.rating),
    tier: num(t.tier),
    tierLabel: t.tierLabel,
    latestDate: t.latestDate || (recent[0]?.date) || null,
    nextFixture,
    dataSource: t.dataSource || 'dataset',
  };
}

// H2H derivado del propio dataset: cruza los partidos guardados del equipo A buscando
// como rival al equipo B (por nombre en ingles o español). 0 llamadas a la API.
export function getDatasetH2H(profileA, profileB) {
  loadDataset();
  const a = teamsById.get(Number(profileA.id));
  const b = teamsById.get(Number(profileB.id));
  if (!a || !b) return { count: 0, avgGoalsA: 0, avgGoalsB: 0, matches: [] };

  const targets = new Set([b.en, b.name].filter(Boolean).map((s) => s.toLowerCase()));
  const goalsA = [];
  const goalsB = [];
  const matches = [];
  for (const m of (matchesByTeam.get(Number(profileA.id)) || [])) {
    if (targets.has(String(m.opponent).toLowerCase())) {
      const ga = num(m.goalsFor);
      const gb = num(m.goalsAgainst);
      goalsA.push(ga); goalsB.push(gb);
      matches.push({ date: m.date, teamA: a.name, teamB: b.name, goalsA: ga, goalsB: gb });
    }
  }
  const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);
  return {
    count: matches.length,
    avgGoalsA: avg(goalsA),
    avgGoalsB: avg(goalsB),
    matches: matches.slice(0, 6),
  };
}
