// Proveedor "datos actuales" OPCIONAL via soccer-data6 (RapidAPI).
// Mas rico que TheSportsDB (varios partidos 2026, xG, stats completas), pero requiere
// cuenta RapidAPI + suscripcion + RAPIDAPI_KEY. Mientras la key este vacia, este
// proveedor queda desactivado y getCurrentData devuelve null (la app cae a la base
// de API-Football, o se usa TheSportsDB segun DATA_SOURCE).
//
// IMPORTANTE: implementacion best-effort NO VERIFICADA. soccer-data6 es un listado
// individual en RapidAPI (parece un wrapper de Sofascore); los endpoints, sus nombres
// y la forma de la respuesta deben confirmarse contra la documentacion real del panel
// de RapidAPI al activar la key. Los TODO marcan lo que hay que ajustar entonces.
//
// Contrato comun de proveedores (ver currentData.js):
//   getCurrentData(apiFootballId, enName) -> {source, latest, next} | null  (misma forma
//   normalizada que theSportsDb.js).

import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- throttle suave + caché en memoria (por vida del proceso) -------------------
const MIN_INTERVAL_MS = 1500;
let lastRequestAt = 0;
let queue = Promise.resolve();
const memoryCache = new Map();

function schedule(fn) {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}

// GET a RapidAPI. `path` es la ruta del endpoint (incluye query). Devuelve JSON o lanza.
async function rapidGet(pathWithQuery) {
  if (memoryCache.has(pathWithQuery)) return memoryCache.get(pathWithQuery);
  const url = `https://${config.rapidApiHost}${pathWithQuery}`;
  const res = await schedule(() => fetch(url, {
    headers: {
      'X-RapidAPI-Key': config.rapidApiKey,
      'X-RapidAPI-Host': config.rapidApiHost,
    },
  }));
  if (!res.ok) throw new Error(`soccer-data6 ${res.status} en ${pathWithQuery}`);
  const json = await res.json();
  memoryCache.set(pathWithQuery, json);
  return json;
}

// --- API publica del proveedor ---------------------------------------------------
export async function getCurrentData(apiFootballId, enName) {
  // Desactivado si no hay key de RapidAPI configurada.
  if (!config.rapidApiKey) return null;

  try {
    // TODO(activar): confirmar endpoints reales en el panel de RapidAPI de soccer-data6.
    // El flujo esperado es:
    //   1) buscar el equipo por nombre (enName) -> obtener el id interno del proveedor.
    //   2) traer sus ultimos partidos -> tomar el mas reciente (date, rival, goles, stats).
    //   3) traer el proximo partido -> (date, rival).
    // Mapear la respuesta a la MISMA forma normalizada que theSportsDb.js:
    //   { source:'soccerdata6',
    //     latest: {date, opponent, opponentApiId, isHome, goalsFor, goalsAgainst, result,
    //              stats:{shots_on_goal,total_shots,corners,fouls,cards}|null},
    //     next: {date, opponent}|null }
    //
    // Ejemplo de esqueleto (rutas a confirmar):
    //   const search = await rapidGet(`/teams/search?name=${encodeURIComponent(enName)}`);
    //   const teamId = pickTeamId(search, apiFootballId, enName);
    //   const lastJson = await rapidGet(`/teams/${teamId}/matches?type=last`);
    //   const nextJson = await rapidGet(`/teams/${teamId}/matches?type=next`);
    //   return normalize(lastJson, nextJson, teamId);

    // Sin implementacion verificada todavia: no romper la app.
    void rapidGet; void apiFootballId; void enName;
    return null;
  } catch {
    return null;
  }
}
