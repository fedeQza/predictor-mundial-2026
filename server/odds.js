// Cuotas del mercado (1X2) en modo SNAPSHOT OFFLINE: lee data/odds.json (generado a mano con
// `npm run import:odds`, que es lo único que pega a The Odds API). Ni la web ni el server consumen
// la API en vivo: solo leen este archivo. Las cuotas son el predictor mejor calibrado, así que el
// modelo las mezcla (blend) con su propia probabilidad de resultado. Espejo del patrón de dcRatings.js.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './dataset.js';

const ODDS_JSON = path.join(DATA_DIR, 'odds.json');

let loaded = false;
let fixtures = []; // [{ date, homeId, awayId, home, away, pHome, pDraw, pAway, nBooks }]

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(ODDS_JSON)) {
      const j = JSON.parse(fs.readFileSync(ODDS_JSON, 'utf8'));
      fixtures = Array.isArray(j.fixtures) ? j.fixtures : [];
    }
  } catch (err) {
    console.warn('[odds] no se pudo cargar odds.json:', err.message);
  }
}

export function hasData() {
  load();
  return fixtures.length > 0;
}

// Inyecta fixtures en memoria (para tests). Espejo de setRatings/setParams.
export function setFixtures(f) { loaded = true; fixtures = Array.isArray(f) ? f : []; }

// Probabilidades de mercado (fracciones 0-1) para un cruce, orientadas a A vs B. null si no hay
// cuotas para ese par (p.ej. un matchup hipotético que no es un partido programado).
export function marketProbsForIds(idA, idB) {
  load();
  const a = Number(idA), b = Number(idB);
  const f = fixtures.find((x) => (x.homeId === a && x.awayId === b) || (x.homeId === b && x.awayId === a));
  if (!f) return null;
  if (f.homeId === a) return { winA: f.pHome, draw: f.pDraw, winB: f.pAway, nBooks: f.nBooks, date: f.date };
  return { winA: f.pAway, draw: f.pDraw, winB: f.pHome, nBooks: f.nBooks, date: f.date };
}
