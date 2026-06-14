// Cliente de API-Football (api-sports.io) con cache en memoria y en disco.
// La API key vive solo aca (servidor); el navegador nunca la ve.

import { config } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'cache');

// Cache en memoria para la vida del proceso.
const memoryCache = new Map();

// --- throttle ------------------------------------------------------------------
// El plan gratuito permite ~10 peticiones por minuto. Serializamos las llamadas reales
// (las cacheadas no cuentan) y dejamos un hueco minimo entre ellas para no recibir 429.
const MIN_INTERVAL_MS = 6700; // ~9 req/min, con margen
let lastRequestAt = 0;
let queue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Encola una funcion async respetando el intervalo minimo entre peticiones reales.
function schedule(fn) {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  // la cola sigue aunque esta tarea falle
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheKey(endpoint, params) {
  const raw = endpoint + '?' + new URLSearchParams(params).toString();
  const hash = crypto.createHash('md5').update(raw).digest('hex');
  return hash;
}

function readDiskCache(key) {
  try {
    const file = path.join(CACHE_DIR, key + '.json');
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch {
    // cache corrupta -> se ignora y se vuelve a pedir
  }
  return null;
}

function writeDiskCache(key, data) {
  try {
    ensureCacheDir();
    fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify(data));
  } catch {
    // si no se puede escribir cache, no es fatal
  }
}

/**
 * Hace una peticion GET a API-Football. Cachea el "response" (array de resultados).
 * @param {string} endpoint  ej: "/teams"
 * @param {object} params    ej: { search: "Argentina" }
 * @param {object} opts      { cache: boolean } -- por defecto true
 * @returns {Promise<{response: any[], quota: object}>}
 */
export async function apiGet(endpoint, params = {}, opts = {}) {
  if (config.demoMode) {
    throw new Error('DEMO_MODE: no hay API key configurada.');
  }

  const useCache = opts.cache !== false;
  const key = cacheKey(endpoint, params);

  if (useCache) {
    if (memoryCache.has(key)) return memoryCache.get(key);
    const disk = readDiskCache(key);
    if (disk) {
      memoryCache.set(key, disk);
      return disk;
    }
  }

  const url = config.apiBaseUrl + endpoint + '?' + new URLSearchParams(params).toString();

  // Petición real, serializada y con un reintento si llega un 429 (limite por minuto).
  const doFetch = () => fetch(url, { headers: { 'x-apisports-key': config.apiKey } });
  let res = await schedule(doFetch);
  if (res.status === 429) {
    await sleep(MIN_INTERVAL_MS);
    res = await schedule(doFetch);
  }

  if (!res.ok) {
    throw new Error(`API-Football error ${res.status} en ${endpoint}`);
  }

  const json = await res.json();

  // API-Football devuelve errores en el cuerpo con 200 OK.
  if (json.errors && Object.keys(json.errors).length > 0) {
    const msg = Object.values(json.errors).join('; ');
    throw new Error(`API-Football: ${msg}`);
  }

  const result = {
    response: json.response || [],
    quota: {
      // cabeceras de cuota del plan
      limitDay: res.headers.get('x-ratelimit-requests-limit'),
      remainingDay: res.headers.get('x-ratelimit-requests-remaining'),
    },
  };

  if (useCache) {
    memoryCache.set(key, result);
    writeDiskCache(key, result);
  }

  return result;
}
