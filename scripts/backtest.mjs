// Backtest del modelo: predice partidos pasados (sin fuga de datos, perfiles "as-of") y mide
// qué tan bien acierta. Sirve para validar Dixon-Coles y elegir rho por log-loss en vez de a ojo.
//
// Test set: partidos entre dos mundialistas desde 2018 con suficiente historial previo.
// Métricas: log-loss (multinomial W/D/L), Brier y accuracy.
// Uso: npm run backtest

import fs from 'node:fs';
import { config } from '../server/config.js';
import { parseCsv } from '../server/dataset.js';
import { repoNameToId, INTL_RESULTS_CSV, getIntlProfile, getIntlH2H } from '../server/intlResults.js';
import { predict } from '../server/model.js';

const SINCE = '2018-01-01';
const MIN_HISTORY = 5;
const RHOS = [0, -0.03, -0.05, -0.06, -0.08, -0.10, -0.13];

const isPlayed = (r) => r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '';

const rows = parseCsv(fs.readFileSync(INTL_RESULTS_CSV, 'utf8'));
const candidates = rows.filter(
  (r) => isPlayed(r) && r.date >= SINCE && repoNameToId(r.home) != null && repoNameToId(r.away) != null,
);

// Pre-construimos las muestras (perfiles as-of la fecha del partido) una sola vez.
const samples = [];
for (const r of candidates) {
  const idA = repoNameToId(r.home);
  const idB = repoNameToId(r.away);
  if (idA === idB) continue;
  const pa = getIntlProfile(idA, config.opponentWeight, r.date);
  const pb = getIntlProfile(idB, config.opponentWeight, r.date);
  if (!pa || !pb || pa.recent.length < MIN_HISTORY || pb.recent.length < MIN_HISTORY) continue;
  const h = getIntlH2H(pa, pb, r.date);
  const hs = Number(r.home_score);
  const as = Number(r.away_score);
  const actual = hs > as ? 0 : hs === as ? 1 : 2; // 0=gana A(local), 1=empate, 2=gana B
  samples.push({ pa, pb, h, actual });
}

console.log(`Partidos de test: ${samples.length} (mundialista vs mundialista, desde ${SINCE}, con >=${MIN_HISTORY} de historial previo)\n`);

function evalRho(rho) {
  let ll = 0, brier = 0, correct = 0;
  for (const s of samples) {
    const o = predict(s.pa, s.pb, s.h, 'goals', { dcRho: rho }).goals.outcome;
    let p = [o.winA / 100, o.draw / 100, o.winB / 100];
    const sum = p[0] + p[1] + p[2];
    if (sum > 0) p = p.map((x) => x / sum);
    const pAct = Math.max(1e-9, p[s.actual]);
    ll += -Math.log(pAct);
    for (let i = 0; i < 3; i++) { const y = i === s.actual ? 1 : 0; brier += (p[i] - y) ** 2; }
    const pred = p.indexOf(Math.max(...p));
    if (pred === s.actual) correct++;
  }
  const n = samples.length || 1;
  return { rho, logloss: ll / n, brier: brier / n, acc: correct / n };
}

console.log('  rho      log-loss   Brier     acc');
console.log('  ----------------------------------');
let best = null;
for (const rho of RHOS) {
  const r = evalRho(rho);
  if (!best || r.logloss < best.logloss) best = r;
  const mark = rho === 0 ? '  (Poisson puro)' : '';
  console.log(`  ${rho.toFixed(2).padStart(5)}    ${r.logloss.toFixed(4)}    ${r.brier.toFixed(4)}    ${(r.acc * 100).toFixed(1)}%${mark}`);
}
console.log(`\nMejor rho por log-loss: ${best.rho}  (log-loss ${best.logloss.toFixed(4)})`);
const base = evalRho(0).logloss;
console.log(best.logloss < base
  ? `Dixon-Coles MEJORA sobre Poisson puro (${base.toFixed(4)} -> ${best.logloss.toFixed(4)}).`
  : 'Dixon-Coles NO mejora aqui; conviene dejar rho=0.');
process.exit(0);
