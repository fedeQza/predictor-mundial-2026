// Proveedor "datos actuales" via la PROPIA API-Football, aprovechando que el plan Free
// permite una ventana movil de ~3 dias (ayer/hoy/manana) por el parametro `date`.
// Durante el Mundial eso incluye la liga "World Cup" con partidos de 2026 + sus estadisticas
// completas (tiros, faltas, corners, tarjetas, xG) y el rival con su id REAL de API-Football.
//
// Ventaja sobre TheSportsDB: stats completas y rating de rival exacto (por id, no por nombre).
// Limitacion: solo ve partidos dentro de la ventana de fechas permitida; si el equipo no jugo
// en esos 3 dias, devuelve sin `latest` (y el dispatcher cae a TheSportsDB). La cache en disco
// hace que los partidos vistos se acumulen aunque la ventana se corra.
//
// Contrato comun (ver currentData.js):
//   getCurrentData(apiFootballId, enName) -> {source, latest, next} | null

import { apiGet } from './apiFootball.js';

const FINISHED = new Set(['FT', 'AET', 'PEN']);
const UPCOMING = new Set(['NS', 'TBD', 'PST']);

// Mapea los "type" de API-Football a nuestras claves de metricas (mismo criterio que dataService).
function mapStatistics(statsArray) {
  const get = (type) => {
    const found = statsArray.find((s) => s.type === type);
    const v = found ? found.value : null;
    return typeof v === 'number' ? v : 0;
  };
  return {
    shots_on_goal: get('Shots on Goal'),
    total_shots: get('Total Shots'),
    corners: get('Corner Kicks'),
    fouls: get('Fouls'),
    cards: get('Yellow Cards') + get('Red Cards'),
  };
}

// Fechas de la ventana permitida: ayer, hoy, manana (en UTC). Si una esta fuera del rango
// que habilita el plan, apiGet lanzara un error de plan y simplemente la salteamos.
function windowDates() {
  const out = [];
  const now = new Date();
  for (let delta = -1; delta <= 1; delta++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + delta);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Trae todos los fixtures de "World Cup" en la ventana en los que participa el equipo.
async function teamWorldCupFixtures(teamId) {
  const fixtures = [];
  for (const date of windowDates()) {
    try {
      const { response } = await apiGet('/fixtures', { date });
      for (const f of response) {
        const isWC = f.league && (f.league.id === 1 || f.league.name === 'World Cup');
        const involves = f.teams?.home?.id === teamId || f.teams?.away?.id === teamId;
        if (isWC && involves) fixtures.push(f);
      }
    } catch {
      // fecha fuera de la ventana del plan (u otro error) -> se saltea
    }
  }
  return fixtures;
}

export async function getCurrentData(apiFootballId, _enName) {
  try {
    const teamId = Number(apiFootballId);
    const fixtures = await teamWorldCupFixtures(teamId);
    if (fixtures.length === 0) return null;

    const finished = fixtures
      .filter((f) => FINISHED.has(f.fixture?.status?.short))
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
    const upcoming = fixtures
      .filter((f) => UPCOMING.has(f.fixture?.status?.short))
      .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));

    let latest = null;
    const fx = finished[0];
    if (fx) {
      const isHome = fx.teams.home.id === teamId;
      const gf = isHome ? fx.goals.home : fx.goals.away;
      const ga = isHome ? fx.goals.away : fx.goals.home;
      const opp = isHome ? fx.teams.away : fx.teams.home;
      let result = 'D';
      if (gf > ga) result = 'W';
      else if (gf < ga) result = 'L';

      // Stats completas del partido (el plan Free las da para fixtures de la ventana).
      let stats = null;
      try {
        const { response } = await apiGet('/fixtures/statistics', {
          fixture: fx.fixture.id,
          team: teamId,
        });
        if (response[0]?.statistics?.length) stats = mapStatistics(response[0].statistics);
      } catch {
        // sin stats -> null
      }

      latest = {
        date: (fx.fixture.date || '').slice(0, 10),
        opponent: opp.name,
        opponentApiId: opp.id, // id real -> rating exacto en dataService
        isHome,
        goalsFor: gf,
        goalsAgainst: ga,
        result,
        stats,
      };
    }

    let next = null;
    const nx = upcoming[0];
    if (nx) {
      const isHome = nx.teams.home.id === teamId;
      next = {
        date: (nx.fixture.date || '').slice(0, 10),
        opponent: (isHome ? nx.teams.away : nx.teams.home).name,
      };
    }

    if (!latest && !next) return null;
    return { source: 'apifootball-live', latest, next };
  } catch {
    return null;
  }
}
