// Carga las fuerzas ataque/defensa del modelo Dixon-Coles desde data/dcParams.json
// (generado con `npm run fit:dc -- --write`). Si el archivo no existe, hasData()=false y el
// modelo cae a la receta heuristica de lambdas. Espejo del patron de eloRatings.js.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './dataset.js';
import { dcLambdas } from './dcModel.js';

const DC_JSON = path.join(DATA_DIR, 'dcParams.json');

let loaded = false;
let model = null; // { c, h, att, def }

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(DC_JSON)) {
      const j = JSON.parse(fs.readFileSync(DC_JSON, 'utf8'));
      if (j && j.att && j.def) model = { c: j.c, h: j.h, att: j.att, def: j.def };
    }
  } catch (err) {
    console.warn('[dcRatings] no se pudo cargar dcParams.json:', err.message);
  }
}

export function hasData() {
  load();
  return model != null;
}

// Inyecta params en memoria (para tuning sin escribir el archivo). Espejo de setRatings.
export function setParams(m) { loaded = true; model = m || null; }

// Lambdas esperados (goles) para un cruce por id. null si falta alguno de los dos equipos.
export function dcLambdasForIds(idA, idB, opts = {}) {
  load();
  if (!model) return null;
  if (model.att[String(idA)] == null || model.att[String(idB)] == null) return null;
  return dcLambdas(model, idA, idB, { neutral: true, ...opts });
}
