// Datos ficticios para el MODO DEMO (cuando no hay API key).
// Se generan de forma DETERMINISTA a partir de las 48 selecciones del Mundial,
// asi el desplegable y las predicciones son estables y coinciden con el modo real.

import { WORLD_CUP_TEAMS, TEAM_BY_ID } from './worldCupTeams.js';
import { getRating, getQuality } from './ratings.js';

function round(n, d = 1) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// PRNG determinista sembrado por el id del equipo (siempre da los mismos numeros).
function seeded(id) {
  let t = (id * 2654435761) % 2147483647;
  if (t <= 0) t += 2147483646;
  return () => {
    t = (t * 48271) % 2147483647;
    return t / 2147483647;
  };
}

function buildRecent(formPoints, gf, ga, rnd) {
  const recent = [];
  for (let i = 0; i < 5; i++) {
    const r = rnd();
    let result, goalsFor, goalsAgainst;
    if (r < formPoints * 0.8) { result = 'W'; goalsFor = Math.max(1, Math.round(gf + 0.5)); goalsAgainst = Math.max(0, Math.round(ga - 0.5)); }
    else if (r > 0.85) { result = 'L'; goalsFor = Math.max(0, Math.round(gf - 0.7)); goalsAgainst = Math.round(ga + 1); }
    else { result = 'D'; goalsFor = Math.round((gf + ga) / 2); goalsAgainst = goalsFor; }
    recent.push({ result, goalsFor, goalsAgainst, opponent: '—', date: `J-${5 - i}` });
  }
  return recent;
}

function buildProfile(team) {
  const rnd = seeded(team.id);
  // Fuerza derivada principalmente del rating de calidad (con algo de azar determinista).
  const rating = getRating(team.id);
  const ratingStrength = Math.max(0, Math.min(1, (rating - 550) / (920 - 550)));
  const strength = 0.8 * ratingStrength + 0.2 * rnd();

  const gf = round(0.8 + strength * 1.8);   // ~0.8 .. 2.6 goles a favor
  const ga = round(1.6 - strength * 1.0);   // ~0.6 .. 1.6 goles en contra
  const formPoints = round(0.35 + strength * 0.5, 2);

  const stats = {
    cards: round(1.6 + rnd() * 1.3),
    shots_on_goal: round(3.5 + strength * 4),
    total_shots: round(9 + strength * 8),
    corners: round(3.5 + strength * 3.5),
    fouls: round(9 + rnd() * 6),
  };

  return {
    id: team.id,
    name: team.name,
    avgGoalsFor: gf,
    avgGoalsAgainst: ga,
    formPoints,
    recent: buildRecent(formPoints, gf, ga, rnd),
    stats,
    ...getQuality(team.id),
  };
}

export function searchDemoTeams() {
  // El desplegable usa la lista completa de las 48.
  return WORLD_CUP_TEAMS.map((t) => ({ id: t.id, name: t.name }));
}

function findDemoTeam(nameOrId) {
  if (TEAM_BY_ID.has(Number(nameOrId))) return TEAM_BY_ID.get(Number(nameOrId));
  const q = String(nameOrId).toLowerCase().trim();
  return WORLD_CUP_TEAMS.find((t) => t.name.toLowerCase() === q)
    || WORLD_CUP_TEAMS.find((t) => t.name.toLowerCase().includes(q));
}

export function getDemoProfile(nameOrId) {
  const team = findDemoTeam(nameOrId);
  if (!team) return null;
  return buildProfile(team);
}

// Head-to-head ficticio derivado de la fuerza relativa de ambos equipos.
export function getDemoH2H(profileA, profileB) {
  const count = 4;
  const avgGoalsA = round((profileA.avgGoalsFor + profileB.avgGoalsAgainst) / 2);
  const avgGoalsB = round((profileB.avgGoalsFor + profileA.avgGoalsAgainst) / 2);
  const matches = [];
  for (let i = 0; i < count; i++) {
    matches.push({
      date: `20${20 + i}`,
      teamA: profileA.name,
      teamB: profileB.name,
      goalsA: Math.round(avgGoalsA),
      goalsB: Math.round(avgGoalsB),
    });
  }
  return { count, avgGoalsA, avgGoalsB, matches };
}
