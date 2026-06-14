// Proveedor "datos actuales" via TheSportsDB (key gratis "3", sin registro).
// Aporta el ultimo partido jugado (2026) + el proximo rival, para superponerlos
// sobre la base multi-partido de API-Football (que en Free no pasa de ~ago-2025).
//
// Contrato comun de proveedores (ver currentData.js):
//   getCurrentData(apiFootballId, enName) -> {
//     source, latest: {date, opponent, opponentApiId, isHome, goalsFor, goalsAgainst,
//                      result, stats|null}, next: {date, opponent}|null } | null

import { config } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'cache');

// --- caché en disco + memoria (prefijo tsdb_ para no chocar con API-Football) ---
const memoryCache = new Map();

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}
function cacheFile(key) {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  return path.join(CACHE_DIR, 'tsdb_' + hash + '.json');
}
function readDiskCache(key) {
  try {
    const file = cacheFile(key);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* cache corrupta -> se re-pide */ }
  return null;
}
function writeDiskCache(key, data) {
  try {
    ensureCacheDir();
    fs.writeFileSync(cacheFile(key), JSON.stringify(data));
  } catch { /* no fatal */ }
}

// --- throttle suave: TheSportsDB free es tolerante, pero somos prudentes ---------
const MIN_INTERVAL_MS = 1500;
let lastRequestAt = 0;
let queue = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// GET cacheado a TheSportsDB. Devuelve el JSON crudo (objeto) o null si falla.
async function tsdbGet(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const cacheKey = `${endpoint}?${qs}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const disk = readDiskCache(cacheKey);
  if (disk) {
    memoryCache.set(cacheKey, disk);
    return disk;
  }
  const url = `${config.tsdbBaseUrl}/${config.tsdbKey}/${endpoint}?${qs}`;
  const res = await schedule(() => fetch(url));
  if (!res.ok) throw new Error(`TheSportsDB ${res.status} en ${endpoint}`);
  const json = await res.json();
  memoryCache.set(cacheKey, json);
  writeDiskCache(cacheKey, json);
  return json;
}

// --- mapeo apiFootballId -> idTeam de TheSportsDB --------------------------------
async function resolveTsdbId(apiFootballId, enName) {
  const json = await tsdbGet('searchteams.php', { t: enName });
  const teams = json?.teams || [];
  const match = teams.find(
    (t) => t.strSport === 'Soccer' && String(t.idAPIfootball) === String(apiFootballId)
  ) || teams.find((t) => t.strSport === 'Soccer');
  return match?.idTeam || null;
}

// --- normalizacion de stats por evento ------------------------------------------
function mapEventStats(eventstats) {
  if (!Array.isArray(eventstats) || eventstats.length === 0) return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  // Para nuestro equipo necesitamos su lado (home/away); lo resuelve el caller via isHome.
  // Aca devolvemos ambos lados por stat y el caller elige.
  const byStat = {};
  for (const s of eventstats) byStat[s.strStat] = { home: num(s.intHome), away: num(s.intAway) };
  return byStat;
}

function statsForSide(byStat, isHome) {
  if (!byStat) return null;
  const side = isHome ? 'home' : 'away';
  const g = (k) => (byStat[k] ? byStat[k][side] : 0);
  const yellow = g('Yellow Cards');
  const red = g('Red Cards');
  const out = {
    shots_on_goal: g('Shots on Goal'),
    total_shots: g('Total Shots'),
    corners: g('Corner Kicks'),
    fouls: g('Fouls'),
    cards: yellow + red,
  };
  // Si TheSportsDB no trajo ninguna de las metricas que usamos, devolvemos null.
  const hasAny = Object.values(out).some((v) => v > 0);
  return hasAny ? out : null;
}

// --- API publica del proveedor ---------------------------------------------------
export async function getCurrentData(apiFootballId, enName) {
  try {
    const tsdbId = await resolveTsdbId(apiFootballId, enName);
    if (!tsdbId) return null;

    // Ultimo partido jugado.
    let latest = null;
    const lastJson = await tsdbGet('eventslast.php', { id: tsdbId });
    const lastEvents = lastJson?.results || lastJson?.events || [];
    const ev = lastEvents[0];
    if (ev && ev.intHomeScore != null && ev.intAwayScore != null) {
      const isHome = String(ev.idHomeTeam) === String(tsdbId);
      const gf = Number(isHome ? ev.intHomeScore : ev.intAwayScore);
      const ga = Number(isHome ? ev.intAwayScore : ev.intHomeScore);
      const opponent = isHome ? ev.strAwayTeam : ev.strHomeTeam;
      let result = 'D';
      if (gf > ga) result = 'W';
      else if (gf < ga) result = 'L';

      // Stats del evento (cobertura parcial en el plan free).
      let stats = null;
      try {
        const statsJson = await tsdbGet('lookupeventstats.php', { id: ev.idEvent });
        stats = statsForSide(mapEventStats(statsJson?.eventstats), isHome);
      } catch { /* sin stats -> null */ }

      latest = {
        date: (ev.dateEvent || '').slice(0, 10),
        opponent,
        opponentApiId: null, // TheSportsDB no expone el idAPIfootball del rival aca
        isHome,
        goalsFor: gf,
        goalsAgainst: ga,
        result,
        stats,
      };
    }

    // Proximo partido.
    let next = null;
    try {
      const nextJson = await tsdbGet('eventsnext.php', { id: tsdbId });
      const nextEvents = nextJson?.events || [];
      const nx = nextEvents[0];
      if (nx) {
        const isHome = String(nx.idHomeTeam) === String(tsdbId);
        next = {
          date: (nx.dateEvent || '').slice(0, 10),
          opponent: isHome ? nx.strAwayTeam : nx.strHomeTeam,
        };
      }
    } catch { /* sin proximo -> null */ }

    if (!latest && !next) return null;
    return { source: 'thesportsdb', latest, next };
  } catch {
    // Cualquier fallo -> el caller sigue solo con API-Football.
    return null;
  }
}
