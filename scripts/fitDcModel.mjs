// Ajusta el modelo Dixon-Coles de ataque/defensa (server/dcModel.js) y lo COMPARA contra el
// modelo heuristico actual en el set de test (2025+), sin fuga de datos. Solo conviene adoptarlo
// si baja el log-loss. Con --write, reajusta sobre todo el historial y escribe data/dcParams.json.
//
// Uso:  npm run fit:dc          (modo gate: compara y recomienda)
//       npm run fit:dc -- --write   (persiste data/dcParams.json con todo el historial)

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { DATA_DIR, parseCsv } from '../server/dataset.js';
import { repoNameToId, INTL_RESULTS_CSV, getIntlProfile, getIntlH2H } from '../server/intlResults.js';
import { WORLD_CUP_TEAMS } from '../server/worldCupTeams.js';
import { predict } from '../server/model.js';
import { fitDcModel, dcLambdas, DEFAULT_DC_PARAMS } from '../server/dcModel.js';

const SINCE_TEST = '2018-01-01';
const SINCE_FIT = '2010-01-01';
const SPLIT = '2025-01-01';
const MIN_HISTORY = 5;

const WRITE = process.argv.includes('--write');
const isPlayed = (r) => r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '' && r.away_score !== '';

// --- probabilidades W/D/L a partir de lambdas (Poisson + Dixon-Coles + temperatura) ----------
function poissonPmf(k, l) { if (l <= 0) return k === 0 ? 1 : 0; let f = 1; for (let i = 2; i <= k; i++) f *= i; return Math.pow(l, k) * Math.exp(-l) / f; }
function dcTau(a, b, la, lb, rho) {
  if (!rho) return 1;
  if (a === 0 && b === 0) return 1 - la * lb * rho;
  if (a === 0 && b === 1) return 1 + la * rho;
  if (a === 1 && b === 0) return 1 + lb * rho;
  if (a === 1 && b === 1) return 1 - rho;
  return 1;
}
function outcomeFromLambdas(la, lb, rho = 0, T = 1) {
  let w = 0, d = 0, l = 0, Z = 0;
  for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) {
    const p = poissonPmf(a, la) * poissonPmf(b, lb) * Math.max(0, dcTau(a, b, la, lb, rho));
    Z += p; if (a > b) w += p; else if (a < b) l += p; else d += p;
  }
  w /= Z; d /= Z; l /= Z;
  if (T !== 1 && T > 0) { const qa = w ** (1 / T), qd = d ** (1 / T), qb = l ** (1 / T), qs = qa + qd + qb; w = qa / qs; d = qd / qs; l = qb / qs; }
  return [w, d, l];
}
function metrics(probs, actuals) {
  let ll = 0, brier = 0, correct = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i], a = actuals[i];
    ll += -Math.log(Math.max(1e-9, p[a]));
    for (let k = 0; k < 3; k++) { const y = k === a ? 1 : 0; brier += (p[k] - y) ** 2; }
    if (p.indexOf(Math.max(...p)) === a) correct++;
  }
  const n = probs.length || 1;
  return { ll: ll / n, brier: brier / n, acc: correct / n, n: probs.length };
}

// --- carga de datos --------------------------------------------------------------------------
const rows = parseCsv(fs.readFileSync(INTL_RESULTS_CSV, 'utf8'));
const playedAll = rows.filter(isPlayed);
const fitTrain = playedAll.filter((r) => r.date >= SINCE_FIT && r.date < SPLIT);   // sin fuga
const fitAll = playedAll.filter((r) => r.date >= SINCE_FIT);                       // para --write

// Muestras de test: mundialista vs mundialista, con perfiles heuristicos as-of (sin fuga).
const samples = [];
for (const r of playedAll) {
  if (r.date < SINCE_TEST) continue;
  const idA = repoNameToId(r.home), idB = repoNameToId(r.away);
  if (idA == null || idB == null || idA === idB) continue;
  const pa = getIntlProfile(idA, config.opponentWeight, r.date);
  const pb = getIntlProfile(idB, config.opponentWeight, r.date);
  if (!pa || !pb || pa.recent.length < MIN_HISTORY || pb.recent.length < MIN_HISTORY) continue;
  const h = getIntlH2H(pa, pb, r.date);
  const hs = Number(r.home_score), as = Number(r.away_score);
  samples.push({ idA, idB, pa, pb, h, actual: hs > as ? 0 : hs === as ? 1 : 2, date: r.date });
}
const train = samples.filter((s) => s.date < SPLIT);
const test = samples.filter((s) => s.date >= SPLIT);
console.log(`Muestras (mundialista vs mundialista, >=${MIN_HISTORY} historial): train ${train.length}, test ${test.length}\n`);

// --- A) modelo heuristico actual (referencia) ------------------------------------------------
function heurProbs(set) {
  return set.map((s) => {
    const o = predict(s.pa, s.pb, s.h, 'goals', { useDcModel: false }).goals.outcome;
    let p = [o.winA / 100, o.draw / 100, o.winB / 100];
    const sum = p[0] + p[1] + p[2]; if (sum > 0) p = p.map((x) => x / sum);
    return p;
  });
}
const heurTest = metrics(heurProbs(test), test.map((s) => s.actual));
const heurTrain = metrics(heurProbs(train), train.map((s) => s.actual));
console.log('=== A) Heuristico actual ===');
console.log(`  train  log-loss ${heurTrain.ll.toFixed(4)}  Brier ${heurTrain.brier.toFixed(4)}  acc ${(heurTrain.acc * 100).toFixed(1)}%`);
console.log(`  test   log-loss ${heurTest.ll.toFixed(4)}  Brier ${heurTest.brier.toFixed(4)}  acc ${(heurTest.acc * 100).toFixed(1)}%\n`);

// --- B) Dixon-Coles MLE: grid de hiperparametros (seleccion por train) -----------------------
const XI = [0.08, 0.12, 0.15, 0.20, 0.30, 0.50];
const L2 = [0.01, 0.02, 0.03, 0.05, 0.10];
const RHO = [0, -0.03, -0.05, -0.08];

function dcProbs(model, set, rho, T) {
  return set.map((s) => { const { lambdaA, lambdaB } = dcLambdas(model, s.idA, s.idB, { neutral: true }); return outcomeFromLambdas(lambdaA, lambdaB, rho, T); });
}

let best = null;
const surface = [];
for (const xiYears of XI) for (const l2 of L2) {
  const model = fitDcModel(fitTrain, { refDate: SPLIT, xiYears, l2 });
  let cellBest = null;
  for (const rho of RHO) {
    const m = metrics(dcProbs(model, train, rho, 1), train.map((s) => s.actual));
    if (!best || m.ll < best.trainLL) best = { xiYears, l2, rho, model, trainLL: m.ll };
    if (!cellBest || m.ll < cellBest.trainLL) cellBest = { rho, trainLL: m.ll };
  }
  // Diagnostico: log-loss de TEST de cada celda (no se usa para elegir; solo para ver estabilidad).
  const te = metrics(dcProbs(model, test, cellBest.rho, 1), test.map((s) => s.actual));
  surface.push({ xiYears, l2, trainLL: cellBest.trainLL, testLL: te.ll });
}
console.log('  superficie (test log-loss por celda, seleccion por train):');
for (const s of surface) console.log(`    xi=${s.xiYears.toFixed(2)} l2=${s.l2.toFixed(2)}  train ${s.trainLL.toFixed(4)}  test ${s.testLL.toFixed(4)}`);
// Temperatura sobre el mejor (seleccion por train).
let bestT = 1, bestTLL = Infinity;
for (const T of [0.85, 0.9, 0.95, 1.0, 1.1, 1.2, 1.3]) {
  const m = metrics(dcProbs(best.model, train, best.rho, T), train.map((s) => s.actual));
  if (m.ll < bestTLL) { bestTLL = m.ll; bestT = T; }
}
const dcTest = metrics(dcProbs(best.model, test, best.rho, bestT), test.map((s) => s.actual));
const dcTrain = metrics(dcProbs(best.model, train, best.rho, bestT), train.map((s) => s.actual));
console.log('=== B) Dixon-Coles MLE (ataque/defensa) ===');
console.log(`  mejor: xiYears=${best.xiYears} l2=${best.l2} rho=${best.rho} T=${bestT}`);
console.log(`  train  log-loss ${dcTrain.ll.toFixed(4)}  Brier ${dcTrain.brier.toFixed(4)}  acc ${(dcTrain.acc * 100).toFixed(1)}%`);
console.log(`  test   log-loss ${dcTest.ll.toFixed(4)}  Brier ${dcTest.brier.toFixed(4)}  acc ${(dcTest.acc * 100).toFixed(1)}%\n`);

// --- C) blend heuristico <-> DC --------------------------------------------------------------
function blendProbs(set, alpha) {
  const hp = heurProbs(set), dp = dcProbs(best.model, set, best.rho, bestT);
  return hp.map((p, i) => [alpha * dp[i][0] + (1 - alpha) * p[0], alpha * dp[i][1] + (1 - alpha) * p[1], alpha * dp[i][2] + (1 - alpha) * p[2]]);
}
let bestA = 0, bestALL = Infinity;
for (const a of [0, 0.25, 0.5, 0.75, 1.0]) {
  const m = metrics(blendProbs(train, a), train.map((s) => s.actual));
  if (m.ll < bestALL) { bestALL = m.ll; bestA = a; }
}
const blTest = metrics(blendProbs(test, bestA), test.map((s) => s.actual));
console.log('=== C) Blend DC<->heuristico ===');
console.log(`  mejor alpha(DC)=${bestA}`);
console.log(`  test   log-loss ${blTest.ll.toFixed(4)}  Brier ${blTest.brier.toFixed(4)}  acc ${(blTest.acc * 100).toFixed(1)}%\n`);

// --- sanity: top/bottom ataque y defensa -----------------------------------------------------
const wcModel = fitDcModel(fitAll, { refDate: new Date().toISOString().slice(0, 10) }); // DEFAULT_DC_PARAMS
const wc = WORLD_CUP_TEAMS.map((t) => ({ name: t.name, att: wcModel.att[String(t.id)] ?? 0, def: wcModel.def[String(t.id)] ?? 0 }));
console.log('=== Cordura (modelo sobre todo el historial) ===');
console.log(`  c=${wcModel.c.toFixed(3)} h=${wcModel.h.toFixed(3)} equipos=${wcModel.nTeams} partidos=${wcModel.nMatches}`);
console.log('  Top ataque:   ' + [...wc].sort((a, b) => b.att - a.att).slice(0, 6).map((x) => `${x.name}(${x.att.toFixed(2)})`).join('  '));
console.log('  Top defensa:  ' + [...wc].sort((a, b) => b.def - a.def).slice(0, 6).map((x) => `${x.name}(${x.def.toFixed(2)})`).join('  '));
console.log('  Peor ataque:  ' + [...wc].sort((a, b) => a.att - b.att).slice(0, 6).map((x) => `${x.name}(${x.att.toFixed(2)})`).join('  '));

// Cruces concretos.
const byName = (n) => WORLD_CUP_TEAMS.find((t) => t.name === n)?.id;
for (const [na, nb] of [['Alemania', 'Curazao'], ['Argentina', 'Brasil']]) {
  const ia = byName(na), ib = byName(nb);
  if (ia && ib) { const { lambdaA, lambdaB } = dcLambdas(wcModel, ia, ib, { neutral: true }); const [w, d, l] = outcomeFromLambdas(lambdaA, lambdaB, best.rho, bestT); console.log(`  ${na} vs ${nb}: lambda ${lambdaA.toFixed(2)}-${lambdaB.toFixed(2)}  W/D/L ${(w * 100).toFixed(0)}/${(d * 100).toFixed(0)}/${(l * 100).toFixed(0)}`); }
}

// --- veredicto -------------------------------------------------------------------------------
console.log('\n=== VEREDICTO (test 2025+, log-loss; menor es mejor) ===');
console.log(`  Heuristico ${heurTest.ll.toFixed(4)}  |  DC ${dcTest.ll.toFixed(4)}  |  Blend ${blTest.ll.toFixed(4)}`);
const winner = Math.min(dcTest.ll, blTest.ll) < heurTest.ll;
console.log(winner ? '  -> El modelo de ataque/defensa MEJORA. Conviene adoptarlo.' : '  -> NO mejora el log-loss; el heuristico se mantiene.');

if (WRITE) {
  // Persistencia con parametros FIJOS de produccion (DEFAULT_DC_PARAMS), no el grid. El modelo en
  // vivo aplica rho/temperatura desde config (DC_RHO/PROB_TEMP). wcModel ya esta ajustado arriba
  // con DEFAULT_DC_PARAMS sobre TODO el historial (refDate=hoy).
  const out = path.join(DATA_DIR, 'dcParams.json');
  const payload = { c: wcModel.c, h: wcModel.h, params: { xiYears: DEFAULT_DC_PARAMS.xiYears, l2: DEFAULT_DC_PARAMS.l2 }, att: wcModel.att, def: wcModel.def, fittedAt: new Date().toISOString() };
  fs.writeFileSync(out, JSON.stringify(payload, null, 0));
  console.log(`\nEscrito ${out} (att/def de ${Object.keys(wcModel.att).length} equipos).`);
}
process.exit(0);
