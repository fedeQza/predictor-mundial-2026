// Calibra los hiperparámetros del Elo (kScale, decay de recencia, mezcla con prior) y la
// temperatura de probabilidades, por log-loss con train/test split (entrena 2018-2024, valida 2025+).
//
// Uso: npm run tune:elo

import fs from 'node:fs';
import { config } from '../server/config.js';
import { parseCsv } from '../server/dataset.js';
import { repoNameToId, INTL_RESULTS_CSV, getIntlProfile, getIntlH2H } from '../server/intlResults.js';
import { computeEloRatings } from '../server/elo.js';
import { setRatings } from '../server/eloRatings.js';
import { predict } from '../server/model.js';

const SOURCE_URL = 'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';
const SINCE_ELO = '2010-01-01';
const SINCE_TEST = '2018-01-01';
const SPLIT = '2025-01-01';
const MIN_HISTORY = 5;
const OW = config.opponentWeight;                       // 1.0
const W = { formWeight: config.formWeight, ratingWeight: config.ratingWeight, h2hWeight: config.h2hWeight, dcRho: config.dcRho };

// Grillas.
const BLEND = [0.3, 0.5, 0.7, 1.0];
const DECAY = [0.02, 0.045, 0.07, 0.10];
const KSCALE = [0.7, 1.0, 1.4];

const isPlayed = (r) => r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '';

console.log('Descargando historial completo para el Elo…');
const full = parseCsv(await (await fetch(SOURCE_URL)).text())
  .filter((r) => r.date && r.date >= SINCE_ELO && isPlayed(r))
  .sort((a, b) => (a.date < b.date ? -1 : 1));

// Partidos de test: mundialista vs mundialista desde 2018 (la lista no depende del Elo).
const subset = parseCsv(fs.readFileSync(INTL_RESULTS_CSV, 'utf8'));
const testMatches = subset.filter(
  (r) => isPlayed(r) && r.date >= SINCE_TEST && repoNameToId(r.home) != null && repoNameToId(r.away) != null,
);

// Reconstruye muestras (perfiles as-of) con los ratings inyectados actuales.
function buildSamples() {
  const out = [];
  for (const r of testMatches) {
    const idA = repoNameToId(r.home), idB = repoNameToId(r.away);
    if (idA === idB) continue;
    const pa = getIntlProfile(idA, OW, r.date);
    const pb = getIntlProfile(idB, OW, r.date);
    if (!pa || !pb || pa.recent.length < MIN_HISTORY || pb.recent.length < MIN_HISTORY) continue;
    const h = getIntlH2H(pa, pb, r.date);
    const hs = Number(r.home_score), as = Number(r.away_score);
    out.push({ pa, pb, h, actual: hs > as ? 0 : hs === as ? 1 : 2, date: r.date });
  }
  return out;
}
function logloss(samples, extra = {}) {
  let ll = 0;
  for (const s of samples) {
    const o = predict(s.pa, s.pb, s.h, 'goals', { useDcModel: false, ...W, ...extra }).goals.outcome;
    let p = [o.winA / 100, o.draw / 100, o.winB / 100];
    const sum = p[0] + p[1] + p[2];
    if (sum > 0) p = p.map((x) => x / sum);
    ll += -Math.log(Math.max(1e-9, p[s.actual]));
  }
  return ll / (samples.length || 1);
}
const split = (arr) => ({ train: arr.filter((s) => s.date < SPLIT), test: arr.filter((s) => s.date >= SPLIT) });

function evalParams(params) {
  const { byId, byName } = computeEloRatings(full, params);
  setRatings(byId, byName);
  const { train, test } = split(buildSamples());
  return { train: logloss(train), test: logloss(test), nTrain: train.length, nTest: test.length };
}

// Baseline (params actuales).
const CURRENT = { kScale: 1.0, decay: 0.045, blend: 0.5, hfa: 100 };
const base = evalParams(CURRENT);
console.log(`Muestras: train ${base.nTrain}, test ${base.nTest}\n`);
console.log(`ACTUAL  blend=0.5 decay=0.045 kScale=1.0  -> train ${base.train.toFixed(4)}  test ${base.test.toFixed(4)}\n`);

// Grid search por log-loss de TRAIN.
let best = null;
for (const blend of BLEND) for (const decay of DECAY) for (const kScale of KSCALE) {
  const r = evalParams({ kScale, decay, blend, hfa: 100 });
  if (!best || r.train < best.train) best = { kScale, decay, blend, ...r };
}
console.log(`MEJOR   blend=${best.blend} decay=${best.decay} kScale=${best.kScale}  -> train ${best.train.toFixed(4)}  test ${best.test.toFixed(4)}`);

// Con el mejor Elo fijo, calibrar temperatura.
evalParams({ kScale: best.kScale, decay: best.decay, blend: best.blend, hfa: 100 });
const samples = split(buildSamples());
let bestT = { t: 1, test: best.test, train: best.train };
console.log('\n  temperatura  train     test');
for (const t of [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5]) {
  const tr = logloss(samples.train, { probTemp: t });
  const te = logloss(samples.test, { probTemp: t });
  if (tr < bestT.train) bestT = { t, train: tr, test: te };
  console.log(`  ${t.toFixed(2)}        ${tr.toFixed(4)}  ${te.toFixed(4)}`);
}

console.log('\n=== Recomendacion (test 2025+) ===');
console.log(`Elo: blend=${best.blend} decay=${best.decay} kScale=${best.kScale}`);
console.log(`Temp: ${bestT.t}`);
console.log(`Log-loss test: actual ${base.test.toFixed(4)} -> Elo ${best.test.toFixed(4)} -> +temp ${bestT.test.toFixed(4)}`);
process.exit(0);
