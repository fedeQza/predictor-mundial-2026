// Modelo Dixon-Coles "completo": estima un ATAQUE y una DEFENSA por seleccion por maxima
// verosimilitud (MLE) sobre todos los partidos a la vez, con decaimiento temporal y
// regularizacion. Reemplaza la receta heuristica de lambdas (promedios + multiplicadores)
// por fuerzas de equipo consistentes entre si. Calculo puro (sin I/O).
//
// Parametrizacion log-lineal:
//   lambda_home = exp(c + att[H] - def[A] + (neutral ? 0 : h))
//   lambda_away = exp(c + att[A] - def[H])
// att alto = anota mas; def alto = concede menos. La ventaja de local `h` SOLO se aplica si el
// partido no es neutral (en el Mundial las canchas son neutrales -> no se usa al predecir).

import { repoNameToId } from './intlResults.js';

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// Clave de equipo: id (numero) si es mundialista, si no 'x:'+nombre. Asi se ajustan TODOS los
// equipos del dataset (rivales no mundialistas incluidos), pero se predice con los 48 por id.
function keyOf(name) {
  const id = repoNameToId(name);
  return id != null ? id : 'x:' + name;
}

// Hiperparametros de produccion (calibrados con npm run fit:dc: el gate compara el grid contra el
// modelo heuristico en test 2025+). xiYears=decaimiento temporal, l2=shrinkage. La superficie de
// test es plana en xi 0.15-0.30 / cualquier l2; se elige 0.20/0.05 (mas shrinkage de seguridad).
export const DEFAULT_DC_PARAMS = { xiYears: 0.20, l2: 0.05, lr: 0.4, iters: 1500, kappa: 6 };

/**
 * Ajusta el modelo por ascenso de gradiente (Poisson ponderado por recencia).
 * @param {Array} rows  filas jugadas {date, home, away, home_score, away_score, neutral}
 * @param {object} opts {refDate, xiYears, l2, lr, iters, kappa}
 * @returns {object} { c, h, xiYears, l2, att:{key->x}, def:{key->x}, nTeams, nMatches }
 */
export function fitDcModel(rows, opts = {}) {
  const { refDate, xiYears, l2, lr, iters, kappa } = { ...DEFAULT_DC_PARAMS, ...opts };
  const ref = refDate ? new Date(refDate).getTime() : Date.now();

  const idx = new Map();
  const teams = [];
  const ensure = (k) => {
    let i = idx.get(k);
    if (i === undefined) { i = teams.length; idx.set(k, i); teams.push(k); }
    return i;
  };

  // Pre-procesa partidos: indices, pesos por recencia, flag neutral.
  const M = [];
  for (const r of rows) {
    const hs = Number(r.home_score), as = Number(r.away_score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const hi = ensure(keyOf(r.home));
    const ai = ensure(keyOf(r.away));
    const ageYears = Math.max(0, (ref - new Date(r.date).getTime()) / YEAR_MS);
    const w = Math.exp(-xiYears * ageYears);
    const neutral = String(r.neutral).toUpperCase() === 'TRUE';
    M.push({ hi, ai, hs, as, w, neutral });
  }

  const n = teams.length;
  const att = new Float64Array(n);
  const def = new Float64Array(n);
  let c = Math.log(1.3);
  let h = 0.2;

  // Suma de pesos por equipo (para normalizar el paso) y totales (para c y h).
  const wsum = new Float64Array(n);
  let totalW = 0, totalWnn = 0;
  for (const m of M) {
    wsum[m.hi] += m.w; wsum[m.ai] += m.w;
    totalW += 2 * m.w;
    if (!m.neutral) totalWnn += m.w;
  }

  const ga = new Float64Array(n);
  const gd = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    let gc = 0, gh = 0;
    ga.fill(0); gd.fill(0);
    for (const m of M) {
      const adv = m.neutral ? 0 : h;
      const lamH = Math.exp(c + att[m.hi] - def[m.ai] + adv);
      const lamA = Math.exp(c + att[m.ai] - def[m.hi]);
      const rH = m.w * (m.hs - lamH);
      const rA = m.w * (m.as - lamA);
      gc += rH + rA;
      if (!m.neutral) gh += rH;
      ga[m.hi] += rH; gd[m.ai] -= rH;
      ga[m.ai] += rA; gd[m.hi] -= rA;
    }
    c += lr * gc / totalW;
    if (totalWnn > 0) h += lr * gh / totalWnn;

    // Paso por equipo con shrinkage ridge (-l2*x): los equipos con pocos partidos se acercan a
    // la media en vez de tomar valores extremos. Normalizado por (wsum+kappa) para estabilidad.
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      const da = lr * (ga[i] - l2 * att[i]) / (wsum[i] + kappa);
      const dd = lr * (gd[i] - l2 * def[i]) / (wsum[i] + kappa);
      att[i] += da; def[i] += dd;
      const m = Math.max(Math.abs(da), Math.abs(dd));
      if (m > maxDelta) maxDelta = m;
    }
    // Centrado a media 0 (identificabilidad).
    let ma = 0, md = 0;
    for (let i = 0; i < n; i++) { ma += att[i]; md += def[i]; }
    ma /= n; md /= n;
    for (let i = 0; i < n; i++) { att[i] -= ma; def[i] -= md; }

    if (it > 50 && maxDelta < 1e-5) break; // convergio
  }

  const attMap = {}, defMap = {};
  for (let i = 0; i < n; i++) { attMap[String(teams[i])] = att[i]; defMap[String(teams[i])] = def[i]; }
  return { c, h, xiYears, l2, att: attMap, def: defMap, nTeams: n, nMatches: M.length };
}

// Lambdas esperados para un cruce por id. Cancha neutral por defecto (Mundial).
export function dcLambdas(model, idA, idB, { neutral = true } = {}) {
  const aA = model.att[String(idA)] ?? 0;
  const dA = model.def[String(idA)] ?? 0;
  const aB = model.att[String(idB)] ?? 0;
  const dB = model.def[String(idB)] ?? 0;
  const adv = neutral ? 0 : (model.h || 0);
  const lambdaA = Math.exp(model.c + aA - dB + adv);
  const lambdaB = Math.exp(model.c + aB - dA);
  return { lambdaA, lambdaB };
}
