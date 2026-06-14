// Descarga los ultimos partidos de las 48 selecciones del Mundial y arma el dataset local
// (data/teams.csv + data/matches.csv) que la app puede consumir con USE_DATASET=1.
//
// Reutiliza server/dataService.getTeamProfile (misma logica que la app: goles ponderados por
// rival, forma, stats detalladas y overlay 2026), asi el CSV refleja exactamente el modelo.
//
// REANUDABLE: se apoya en el cache en disco. Los equipos ya construidos NO se vuelven a bajar.
// Por el limite de 100 req/dia del plan Free, corrélo 1 vez por dia (tras el reset 00:00 UTC)
// hasta llegar a 48/48. Recomendado para entrar en ~3 dias:
//   SEASONS=2024 STATS_MATCHES=4 npm run build:dataset
//
// Uso: npm run build:dataset

import fs from 'node:fs';
import { config } from '../server/config.js';
import { getTeamProfile } from '../server/dataService.js';
import { WORLD_CUP_TEAMS } from '../server/worldCupTeams.js';
import {
  DATA_DIR, TEAMS_CSV, MATCHES_CSV, TEAMS_HEADER, MATCHES_HEADER, toCsv, parseCsv,
} from '../server/dataset.js';

// Forzar modo LIVE durante la construccion (aunque .env tenga USE_DATASET=1), si no el
// builder leeria del propio CSV en vez de bajar de la API.
config.useDataset = false;

const MIN_MATCHES = 5;      // un perfil con menos se considera incompleto (cuota agotada)
const STOP_AFTER_FAILS = 3; // frenar tras N fallos/finos seguidos (cuota probablemente agotada)

function round(n, d = 4) {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
}

function buildTeamRow(team, p) {
  return {
    id: team.id,
    name: p.name || team.name,
    en: team.en,
    conf: team.conf,
    rating: p.rating,
    tier: p.tier,
    tierLabel: p.tierLabel,
    avgGoalsFor: round(p.avgGoalsFor),
    avgGoalsAgainst: round(p.avgGoalsAgainst),
    formPoints: round(p.formPoints),
    shots_on_goal: round(p.stats.shots_on_goal, 3),
    total_shots: round(p.stats.total_shots, 3),
    corners: round(p.stats.corners, 3),
    fouls: round(p.stats.fouls, 3),
    cards: round(p.stats.cards, 3),
    latestDate: p.latestDate || '',
    nextDate: p.nextFixture?.date || '',
    nextOpponent: p.nextFixture?.opponent || '',
    dataSource: p.dataSource || 'apifootball',
  };
}

function buildMatchRows(id, p) {
  return (p.recent || []).map((m) => ({
    teamId: id,
    date: m.date,
    opponent: m.opponent,
    opponentRating: m.opponentRating,
    goalsFor: m.goalsFor,
    goalsAgainst: m.goalsAgainst,
    result: m.result,
  }));
}

function loadExisting() {
  const teamRowsById = new Map();
  const matchRowsById = new Map();
  if (fs.existsSync(TEAMS_CSV)) {
    for (const r of parseCsv(fs.readFileSync(TEAMS_CSV, 'utf8'))) teamRowsById.set(Number(r.id), r);
  }
  if (fs.existsSync(MATCHES_CSV)) {
    for (const m of parseCsv(fs.readFileSync(MATCHES_CSV, 'utf8'))) {
      const id = Number(m.teamId);
      if (!matchRowsById.has(id)) matchRowsById.set(id, []);
      matchRowsById.get(id).push(m);
    }
  }
  return { teamRowsById, matchRowsById };
}

function writeOut(teamRowsById, matchRowsById) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const teamsOut = WORLD_CUP_TEAMS.filter((t) => teamRowsById.has(t.id)).map((t) => teamRowsById.get(t.id));
  const matchesOut = [];
  for (const t of WORLD_CUP_TEAMS) {
    if (matchRowsById.has(t.id)) matchesOut.push(...matchRowsById.get(t.id));
  }
  fs.writeFileSync(TEAMS_CSV, toCsv(TEAMS_HEADER, teamsOut));
  fs.writeFileSync(MATCHES_CSV, toCsv(MATCHES_HEADER, matchesOut));
}

async function main() {
  if (config.demoMode) {
    console.error('No hay APIFOOTBALL_KEY: el builder necesita datos reales. Cargá la key en .env.');
    process.exit(1);
  }

  const { teamRowsById, matchRowsById } = loadExisting();
  const builtIds = new Set(teamRowsById.keys());

  console.log(`Arranco. Ya construidos: ${builtIds.size}/48. Seasons=${config.seasons.join(',')} statsMatches=${config.statsMatches}\n`);

  const pending = [];
  let done = builtIds.size;
  let consecutiveFails = 0;

  for (const team of WORLD_CUP_TEAMS) {
    if (builtIds.has(team.id)) continue; // ya estaba: no gastamos cuota
    process.stdout.write(`  ${team.name} (${team.id})... `);
    try {
      const p = await getTeamProfile(team.id);
      const n = p.recent?.length || 0;
      if (n >= MIN_MATCHES) {
        teamRowsById.set(team.id, buildTeamRow(team, p));
        matchRowsById.set(team.id, buildMatchRows(team.id, p));
        builtIds.add(team.id);
        done++;
        consecutiveFails = 0;
        writeOut(teamRowsById, matchRowsById); // guardado incremental (por si se corta)
        console.log(`OK — ${n} partidos`);
      } else {
        pending.push(team.name);
        consecutiveFails++;
        console.log(`fino (${n} partidos) → pendiente`);
      }
    } catch (err) {
      pending.push(team.name);
      consecutiveFails++;
      console.log(`ERROR: ${err.message} → pendiente`);
    }
    if (consecutiveFails >= STOP_AFTER_FAILS) {
      console.log('\n>> 3 fallos seguidos: probablemente se agotó la cuota diaria. Freno acá.');
      console.log('   Reanudá mañana tras el reset (00:00 UTC) con: npm run build:dataset');
      break;
    }
  }

  writeOut(teamRowsById, matchRowsById);
  console.log(`\nResultado: ${done}/48 listos.`);
  if (pending.length) console.log(`Pendientes (${pending.length}): ${pending.join(', ')}`);
  else console.log('¡Dataset completo! Activá el consumo con USE_DATASET=1 en .env.');
  process.exit(0);
}

main();
