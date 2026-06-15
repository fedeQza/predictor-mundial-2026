// Ratings data-driven (Elo) calculados desde el historial real de resultados.
// Se generan con `npm run compute:ratings` -> data/ratings.json { byId, byName }.
// Si el archivo no existe, hasData()=false y el resto del código cae a ratings.js (hand-tuned).

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './dataset.js';
import { getTier } from './ratings.js';

const RATINGS_JSON = path.join(DATA_DIR, 'ratings.json');

let loaded = false;
let byId = {};
let byName = {};

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(RATINGS_JSON)) {
      const j = JSON.parse(fs.readFileSync(RATINGS_JSON, 'utf8'));
      byId = j.byId || {};
      byName = j.byName || {};
    }
  } catch (err) {
    console.warn('[eloRatings] no se pudo cargar ratings.json:', err.message);
  }
}

export function hasData() {
  load();
  return Object.keys(byId).length > 0;
}

// Inyecta ratings en memoria (lo usa tuneElo.mjs para probar distintos hiperparámetros sin
// escribir el archivo). Sobrescribe lo cargado del JSON.
export function setRatings(newById, newByName) {
  loaded = true;
  byId = newById || {};
  byName = newByName || {};
}

// Rating por id (las 48). null si no está.
export function ratingForId(id) {
  load();
  const r = byId[String(id)] ?? byId[Number(id)];
  return typeof r === 'number' ? r : null;
}

// Rating por nombre del repo (cualquier selección con suficientes partidos). null si no está.
export function ratingForName(name) {
  load();
  const r = byName[name];
  return typeof r === 'number' ? r : null;
}

// Calidad (rating + nivel) por id, usando el rating data-driven. null si no está.
export function qualityForId(id) {
  const rating = ratingForId(id);
  if (rating == null) return null;
  const { tier, label } = getTier(rating);
  return { rating, tier, tierLabel: label };
}
