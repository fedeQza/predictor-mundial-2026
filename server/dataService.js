// Servicio de datos: arma el "perfil" de cada equipo (forma, goles, stats) y el head-to-head.
// Usa API-Football si hay key; si no, cae a los datos demo.

import { config } from './config.js';
import { apiGet } from './apiFootball.js';
import { getCurrentData } from './currentData.js';
import { getDemoProfile, getDemoH2H } from './demoData.js';
import { hasDatasetTeam, getDatasetProfile, getDatasetH2H } from './dataset.js';
import { hasData as intlHasData, hasIntlTeam, getIntlProfile, getIntlH2H } from './intlResults.js';
import { qualityForId as eloQualityForId } from './eloRatings.js';
import { WORLD_CUP_TEAMS, getTeamName, getTeamEn } from './worldCupTeams.js';
import { getRating, getQuality, REFERENCE_RATING, DEFAULT_RATING } from './ratings.js';

const FINISHED = new Set(['FT', 'AET', 'PEN']);

// Lista para el desplegable: las 48 selecciones del Mundial (mismos ids en demo y real).
export function getTeamsList() {
  return WORLD_CUP_TEAMS.map((t) => ({
    id: t.id, name: t.name, conf: t.conf,
    ...(eloQualityForId(t.id) || getQuality(t.id)),
  }));
}

// Factor de ponderacion de un partido segun el rating del rival.
// >1 si el rival es mejor que la referencia, <1 si es peor. Se atenua con opponentWeight.
function opponentFactor(opponentRating, opponentWeight = config.opponentWeight) {
  const raw = opponentRating / REFERENCE_RATING;
  return 1 + (raw - 1) * opponentWeight;
}

// Mapeo de los "type" de API-Football a nuestras claves de metricas.
// IMPORTANTE: API-Football suele devolver los 18 "type" presentes pero con value=null para
// muchos partidos (p.ej. eliminatorias CAF de Senegal: solo trae tarjetas). Preservamos null
// para distinguir "no hay dato" de un 0 real; asi no inventamos "0 tiros" donde falta cobertura.
function mapStatistics(statsArray) {
  const get = (type) => {
    const found = statsArray.find((s) => s.type === type);
    const v = found ? found.value : null;
    return typeof v === 'number' ? v : null;
  };
  const yellow = get('Yellow Cards');
  const red = get('Red Cards');
  const cards = (yellow == null && red == null) ? null : (yellow ?? 0) + (red ?? 0);
  return {
    shots_on_goal: get('Shots on Goal'),
    total_shots: get('Total Shots'),
    corners: get('Corner Kicks'),
    fouls: get('Fouls'),
    cards,
  };
}

// Promedio que ignora los partidos sin dato real para esa metrica. null si no hay ninguno
// (asi el panel puede mostrar "sin datos" en vez de un 0 enganoso).
function average(nums) {
  const valid = nums.filter((n) => typeof n === 'number');
  if (valid.length === 0) return null;
  return valid.reduce((s, n) => s + n, 0) / valid.length;
}

// Rating de un rival a partir de su nombre (el overlay 2026 trae el rival como texto,
// no como id). Busca en las 48 selecciones por nombre ES o EN; si no, rating por defecto.
function ratingByName(name) {
  if (!name) return DEFAULT_RATING;
  const q = String(name).toLowerCase().trim();
  const match = WORLD_CUP_TEAMS.find(
    (t) => t.name.toLowerCase() === q || (t.en && t.en.toLowerCase() === q)
  ) || WORLD_CUP_TEAMS.find(
    (t) => t.name.toLowerCase().includes(q) || (t.en && t.en.toLowerCase().includes(q))
  );
  return match ? getRating(match.id) : DEFAULT_RATING;
}

// --- resolucion de equipos ------------------------------------------------------

// El desplegable envia el id de API-Football. Si llega un nombre, lo buscamos en la
// lista del Mundial (sin gastar peticiones a la API).
function resolveTeamId(nameOrId) {
  if (/^\d+$/.test(String(nameOrId))) {
    const id = Number(nameOrId);
    return { id, name: getTeamName(id) };
  }
  const q = String(nameOrId).toLowerCase().trim();
  const match = WORLD_CUP_TEAMS.find((t) => t.name.toLowerCase() === q)
    || WORLD_CUP_TEAMS.find((t) => t.name.toLowerCase().includes(q));
  return match ? { id: match.id, name: match.name } : null;
}

export async function getTeamProfile(nameOrId, opts = {}) {
  const opponentWeight = opts.opponentWeight ?? config.opponentWeight;

  if (config.demoMode) {
    const p = getDemoProfile(nameOrId);
    if (!p) throw new Error(`Equipo no encontrado en demo: "${nameOrId}"`);
    return p;
  }

  const resolved = resolveTeamId(nameOrId);
  if (!resolved) throw new Error(`Equipo no encontrado: "${nameOrId}"`);
  const teamId = resolved.id;

  // Fuente primaria: dataset de resultados internacionales (repo martj42). Goles/forma/
  // historial reales sin tocar la API. Las stats detalladas se traen aparte (boton "Consultar API").
  if (config.useIntl && hasIntlTeam(teamId)) {
    const intlProfile = getIntlProfile(teamId, opponentWeight);
    if (intlProfile) return intlProfile;
  }

  // Modo dataset (snapshot por API): si el equipo esta en el CSV, lo servimos desde ahi.
  if (config.useDataset && hasDatasetTeam(teamId)) {
    return getDatasetProfile(teamId);
  }

  // El plan gratuito no admite `last`, asi que pedimos por temporada y combinamos.
  // Si una temporada esta bloqueada por el plan (p.ej. 2025/2026 en Free) o falla, la
  // salteamos en vez de romper la prediccion: la base usa las que si esten disponibles y
  // el overlay 2026 aporta lo actual igual.
  let fixtures = [];
  for (const season of config.seasons) {
    try {
      const { response } = await apiGet('/fixtures', { team: teamId, season });
      fixtures = fixtures.concat(response);
    } catch (err) {
      console.warn(`[dataService] temporada ${season} no disponible (${err.message}); se saltea.`);
    }
  }

  // Partidos terminados, ordenados del mas reciente al mas viejo.
  const finished = fixtures
    .filter((f) => FINISHED.has(f.fixture?.status?.short))
    .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
    .slice(0, config.recentMatches);

  let teamName = resolved.name;
  const recent = [];
  const adjGoalsFor = [];
  const adjGoalsAgainst = [];
  const formPointsArr = [];

  for (const f of finished) {
    const isHome = f.teams.home.id === teamId;
    const gf = isHome ? f.goals.home : f.goals.away;
    const ga = isHome ? f.goals.away : f.goals.home;
    if (!teamName) teamName = isHome ? f.teams.home.name : f.teams.away.name;

    let result = 'D';
    if (gf > ga) result = 'W';
    else if (gf < ga) result = 'L';

    // Ponderacion por calidad del rival: golear a un fuerte vale mas (factor>1);
    // recibir goles de un debil penaliza mas (se divide por el factor).
    const opponentTeam = isHome ? f.teams.away : f.teams.home;
    const oppRating = getRating(opponentTeam.id);
    const factor = opponentFactor(oppRating, opponentWeight);
    adjGoalsFor.push(gf * factor);
    adjGoalsAgainst.push(ga / factor);

    formPointsArr.push(result === 'W' ? 3 : result === 'D' ? 1 : 0);

    recent.push({
      result,
      goalsFor: gf,
      goalsAgainst: ga,
      opponent: opponentTeam.name,
      opponentRating: oppRating,
      date: (f.fixture.date || '').slice(0, 10),
    });
  }

  // Stats detalladas de API-Football: promedio sobre los ultimos statsMatches partidos.
  const statsFixtures = finished.slice(0, config.statsMatches);
  const perMatchStats = [];
  for (const f of statsFixtures) {
    try {
      const { response } = await apiGet('/fixtures/statistics', {
        fixture: f.fixture.id,
        team: teamId,
      });
      if (response[0]?.statistics?.length) {
        perMatchStats.push(mapStatistics(response[0].statistics));
      }
    } catch {
      // si un partido no tiene stats, se ignora
    }
  }

  // --- overlay de datos actuales (2026) -----------------------------------------
  // Superpone el partido mas reciente (y su proximo rival) desde la fuente elegida
  // (TheSportsDB por defecto). Se mezcla ANTES de promediar para reflejar la actualidad.
  let nextFixture = null;
  let dataSource = 'apifootball';
  const newestApiDate = finished[0] ? (finished[0].fixture.date || '').slice(0, 10) : '';

  if (config.dataSource !== 'apifootball') {
    try {
      const cur = await getCurrentData(teamId, getTeamEn(teamId));
      if (cur) {
        dataSource = cur.source;
        nextFixture = cur.next || null;

        const lt = cur.latest;
        // Solo si el partido del overlay es MAS NUEVO que el ultimo de API-Football
        // (evita doble conteo; en la practica no se solapan: API <= ago-2025, overlay 2026).
        if (lt && lt.date && lt.date > newestApiDate) {
          const oppRating = lt.opponentApiId != null
            ? getRating(lt.opponentApiId)
            : ratingByName(lt.opponent);
          const factor = opponentFactor(oppRating, opponentWeight);

          adjGoalsFor.unshift(lt.goalsFor * factor);
          adjGoalsAgainst.unshift(lt.goalsAgainst / factor);
          formPointsArr.unshift(lt.result === 'W' ? 3 : lt.result === 'D' ? 1 : 0);
          recent.unshift({
            result: lt.result,
            goalsFor: lt.goalsFor,
            goalsAgainst: lt.goalsAgainst,
            opponent: lt.opponent,
            opponentRating: oppRating,
            date: lt.date,
          });
          if (lt.stats) perMatchStats.unshift(lt.stats);
        }
      }
    } catch {
      // si el overlay falla, seguimos solo con API-Football
    }
  }

  // Forma reciente: puntos de los ultimos 5, normalizados 0..1 (ya con el overlay si aplica).
  const last5 = formPointsArr.slice(0, 5);
  const formPoints = last5.length ? average(last5) / 3 : 0.5;

  const stats = {
    shots_on_goal: average(perMatchStats.map((s) => s.shots_on_goal)),
    total_shots: average(perMatchStats.map((s) => s.total_shots)),
    corners: average(perMatchStats.map((s) => s.corners)),
    fouls: average(perMatchStats.map((s) => s.fouls)),
    cards: average(perMatchStats.map((s) => s.cards)),
  };

  const latestDate = recent[0]?.date || newestApiDate || null;

  return {
    id: teamId,
    name: teamName || String(nameOrId),
    // Promedios ya ponderados por la calidad de los rivales enfrentados.
    avgGoalsFor: average(adjGoalsFor),
    avgGoalsAgainst: average(adjGoalsAgainst),
    formPoints,
    recent: recent.slice(0, 10),
    stats,
    latestDate,
    nextFixture,
    dataSource,
    ...getQuality(teamId),
  };
}

// --- head-to-head ---------------------------------------------------------------

export async function getH2H(profileA, profileB) {
  if (config.demoMode) return getDemoH2H(profileA, profileB);

  // Fuente primaria: H2H real desde el dataset de resultados (repo). 0 llamadas a la API.
  if (config.useIntl && intlHasData()) return getIntlH2H(profileA, profileB);

  // Modo dataset (snapshot por API): H2H derivado de los partidos guardados.
  if (config.useDataset) return getDatasetH2H(profileA, profileB);

  // El plan gratuito no admite `last`: traemos todo el historial y recortamos localmente.
  const { response } = await apiGet('/fixtures/headtohead', {
    h2h: `${profileA.id}-${profileB.id}`,
  });

  const finished = response
    .filter((f) => FINISHED.has(f.fixture?.status?.short))
    .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  const goalsA = [];
  const goalsB = [];
  const matches = [];

  for (const f of finished) {
    const aIsHome = f.teams.home.id === profileA.id;
    const ga = aIsHome ? f.goals.home : f.goals.away;
    const gb = aIsHome ? f.goals.away : f.goals.home;
    goalsA.push(ga);
    goalsB.push(gb);
    matches.push({
      date: (f.fixture.date || '').slice(0, 10),
      teamA: profileA.name,
      teamB: profileB.name,
      goalsA: ga,
      goalsB: gb,
    });
  }

  return {
    count: matches.length,
    avgGoalsA: average(goalsA),
    avgGoalsB: average(goalsB),
    matches: matches.slice(0, 6),
  };
}

// --- stats detalladas on-demand (boton "Consultar API") -------------------------

// Trae las stats detalladas (tarjetas, tiros, corners, faltas) promediadas de los ultimos
// statsMatches partidos terminados de un equipo, via API-Football. Cuesta cuota; por eso se
// invoca solo cuando el usuario aprieta el boton. Lanza si la API no devuelve nada.
export async function fetchTeamStats(nameOrId) {
  const resolved = resolveTeamId(nameOrId);
  if (!resolved) throw new Error(`Equipo no encontrado: "${nameOrId}"`);
  const teamId = resolved.id;

  let fixtures = [];
  for (const season of config.seasons) {
    try {
      const { response } = await apiGet('/fixtures', { team: teamId, season });
      fixtures = fixtures.concat(response);
    } catch {
      // temporada bloqueada/sin cuota -> se saltea
    }
  }
  const finished = fixtures
    .filter((f) => FINISHED.has(f.fixture?.status?.short))
    .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
    .slice(0, config.statsMatches);

  const perMatchStats = [];
  for (const f of finished) {
    try {
      const { response } = await apiGet('/fixtures/statistics', { fixture: f.fixture.id, team: teamId });
      if (response[0]?.statistics?.length) perMatchStats.push(mapStatistics(response[0].statistics));
    } catch {
      // sin stats en ese partido -> se ignora
    }
  }
  if (perMatchStats.length === 0) {
    throw new Error('La API no devolvió estadísticas (sin cuota o sin datos disponibles).');
  }
  return {
    id: teamId,
    name: resolved.name,
    shots_on_goal: average(perMatchStats.map((s) => s.shots_on_goal)),
    total_shots: average(perMatchStats.map((s) => s.total_shots)),
    corners: average(perMatchStats.map((s) => s.corners)),
    fouls: average(perMatchStats.map((s) => s.fouls)),
    cards: average(perMatchStats.map((s) => s.cards)),
  };
}
