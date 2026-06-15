// Calibra los pesos del modelo (forma, calidad/rating, H2H, calidad del rival) buscando la
// combinacion que minimiza log-loss en datos reales. Usa train/test split para no sobreajustar:
// entrena con partidos 2018-2024 y valida en 2025+.
//
// Uso: npm run tune

import fs from 'node:fs';
import { config } from '../server/config.js';
import { parseCsv } from '../server/dataset.js';
import { repoNameToId, INTL_RESULTS_CSV, getIntlProfile, getIntlH2H } from '../server/intlResults.js';
import { predict } from '../server/model.js';

const SINCE = '2018-01-01';
const SPLIT = '2025-01-01';
const MIN_HISTORY = 5;
const DC_RHO = config.dcRho;

// Grillas de busqueda.
const OW = [0.6, 0.8, 1.0, 1.2];          // opponentWeight (afecta el perfil -> se reconstruye)
const FW = [0.0, 0.05, 0.10, 0.20];       // formWeight
const RW = [0.60, 0.75, 0.90, 1.10];      // ratingWeight
const HW = [0.10, 0.20, 0.30];            // h2hWeight
const CURRENT = { ow: 0.60, fw: 0.25, rw: 0.40, hw: 0.15 };

const isPlayed = (r) => r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '';
const rows = parseCsv(fs.readFileSync(INTL_RESULTS_CSV, 'utf8'));
const matches = rows.filter(
  (r) => isPlayed(r) && r.date >= SINCE && repoNameToId(r.home) != null && repoNameToId(r.away) != null,
);

// Construye las muestras (perfiles as-of) para un opponentWeight dado.
function buildSamples(ow) {
  const out = [];
  for (const r of matches) {
    const idA = repoNameToId(r.home), idB = repoNameToId(r.away);
    if (idA === idB) continue;
    const pa = getIntlProfile(idA, ow, r.date);
    const pb = getIntlProfile(idB, ow, r.date);
    if (!pa || !pb || pa.recent.length < MIN_HISTORY || pb.recent.length < MIN_HISTORY) continue;
    const h = getIntlH2H(pa, pb, r.date);
    const hs = Number(r.home_score), as = Number(r.away_score);
    out.push({ pa, pb, h, actual: hs > as ? 0 : hs === as ? 1 : 2, date: r.date });
  }
  return out;
}

function logloss(samples, w) {
  let ll = 0;
  for (const s of samples) {
    // useDcModel:false -> este tuner calibra el modelo HEURISTICO (fallback); el DC tiene su gate (npm run fit:dc).
    const o = predict(s.pa, s.pb, s.h, 'goals', { useDcModel: false, ...w }).goals.outcome;
    let p = [o.winA / 100, o.draw / 100, o.winB / 100];
    const sum = p[0] + p[1] + p[2];
    if (sum > 0) p = p.map((x) => x / sum);
    ll += -Math.log(Math.max(1e-9, p[s.actual]));
  }
  return ll / (samples.length || 1);
}

// Precomputar muestras por opponentWeight (incluye 0.6 para evaluar el actual).
const owValues = [...new Set([...OW, CURRENT.ow])];
const samplesByOw = {};
for (const ow of owValues) samplesByOw[ow] = buildSamples(ow);
const splitOf = (arr) => ({ train: arr.filter((s) => s.date < SPLIT), test: arr.filter((s) => s.date >= SPLIT) });

const ref = splitOf(samplesByOw[CURRENT.ow]);
console.log(`Muestras: ${samplesByOw[CURRENT.ow].length}  (train <${SPLIT}: ${ref.train.length}, test: ${ref.test.length})`);
console.log(`DC rho fijo en ${DC_RHO}\n`);

// Evaluar config ACTUAL.
const curW = { formWeight: CURRENT.fw, ratingWeight: CURRENT.rw, h2hWeight: CURRENT.hw, dcRho: DC_RHO };
const curTrain = logloss(ref.train, curW), curTest = logloss(ref.test, curW);
console.log(`ACTUAL  ow=${CURRENT.ow} fw=${CURRENT.fw} rw=${CURRENT.rw} hw=${CURRENT.hw}  -> train ${curTrain.toFixed(4)}  test ${curTest.toFixed(4)}`);

// Grid search por log-loss de TRAIN.
let best = null;
for (const ow of OW) {
  const { train } = splitOf(samplesByOw[ow]);
  for (const fw of FW) for (const rw of RW) for (const hw of HW) {
    const w = { formWeight: fw, ratingWeight: rw, h2hWeight: hw, dcRho: DC_RHO };
    const ll = logloss(train, w);
    if (!best || ll < best.ll) best = { ow, fw, rw, hw, ll };
  }
}
const bestTest = logloss(splitOf(samplesByOw[best.ow]).test, { formWeight: best.fw, ratingWeight: best.rw, h2hWeight: best.hw, dcRho: DC_RHO });
console.log(`MEJOR   ow=${best.ow} fw=${best.fw} rw=${best.rw} hw=${best.hw}  -> train ${best.ll.toFixed(4)}  test ${bestTest.toFixed(4)}`);

// Comparar candidatos concretos (test = lo honesto). Elegimos un punto robusto, no el extremo.
const CANDIDATES = [
  { name: 'actual    ', ow: 0.6, fw: 0.25, rw: 0.40, hw: 0.15 },
  { name: 'moderado  ', ow: 0.8, fw: 0.10, rw: 0.70, hw: 0.20 },
  { name: 'fuerte    ', ow: 1.0, fw: 0.05, rw: 0.90, hw: 0.20 },
  { name: 'extremo   ', ow: 1.2, fw: 0.00, rw: 1.10, hw: 0.20 },
];
console.log('\n  candidato    ow   fw   rw   hw    train     test');
for (const c of CANDIDATES) {
  const sp = splitOf(samplesByOw[c.ow] || buildSamples(c.ow));
  const w = { formWeight: c.fw, ratingWeight: c.rw, h2hWeight: c.hw, dcRho: DC_RHO };
  console.log(`  ${c.name}  ${c.ow}  ${c.fw.toFixed(2)} ${c.rw.toFixed(2)} ${c.hw.toFixed(2)}   ${logloss(sp.train, w).toFixed(4)}   ${logloss(sp.test, w).toFixed(4)}`);
}

console.log('\n=== Veredicto (sobre TEST 2025+, lo honesto) ===');
if (bestTest < curTest) {
  console.log(`Los pesos optimos MEJORAN: test ${curTest.toFixed(4)} -> ${bestTest.toFixed(4)} (-${(curTest - bestTest).toFixed(4)}).`);
  console.log(`Setear: OPPONENT_WEIGHT=${best.ow} FORM_WEIGHT=${best.fw} RATING_WEIGHT=${best.rw} H2H_WEIGHT=${best.hw}`);
} else {
  console.log(`Los pesos actuales ya son buenos: el mejor de train no supera en test (${bestTest.toFixed(4)} vs ${curTest.toFixed(4)}). Mantener actuales.`);
}
process.exit(0);
