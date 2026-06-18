// Reporte comparativo de la Jornada 1 del Mundial 2026: lo que el modelo daba ANTES de cada partido
// (perfiles as-of, sin fuga de datos) vs el resultado real. Mide log-loss / Brier / acierto sobre los
// partidos ya jugados. Es una medición (no toca el modelo): sirve de cordura y de insumo para una
// eventual mejora. Reusa el patrón de scripts/backtest.mjs.
//
// Uso: npm run report:wc

import fs from 'node:fs';
import { config } from '../server/config.js';
import { parseCsv } from '../server/dataset.js';
import { repoNameToId, INTL_RESULTS_CSV, getIntlProfile, getIntlH2H } from '../server/intlResults.js';
import { predict } from '../server/model.js';
import { marketProbsForIds } from '../server/odds.js';

const SINCE = '2026-06-01'; // fase de grupos del Mundial 2026
const isPlayed = (r) => r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '';

const rows = parseCsv(fs.readFileSync(INTL_RESULTS_CSV, 'utf8'));
const matches = rows
  .filter((r) => r.tournament === 'FIFA World Cup' && r.date >= SINCE && isPlayed(r)
    && repoNameToId(r.home) != null && repoNameToId(r.away) != null)
  .sort((a, b) => (a.date < b.date ? -1 : 1));

if (matches.length === 0) {
  console.log('No hay partidos del Mundial 2026 jugados en el dataset todavía.');
  process.exit(0);
}

const RES = ['1', 'X', '2']; // 0=gana local, 1=empate, 2=gana visitante
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const padL = (s, n) => String(s).padStart(n);

let ll = 0, brier = 0, correct = 0, n = 0;
let llMkt = 0, correctMkt = 0, nMkt = 0;
let sumConf = 0; // confianza media del modelo (prob del favorito)
const tableRows = [];

for (const r of matches) {
  const idA = repoNameToId(r.home), idB = repoNameToId(r.away);
  if (idA === idB) continue;
  const pa = getIntlProfile(idA, config.opponentWeight, r.date);
  const pb = getIntlProfile(idB, config.opponentWeight, r.date);
  if (!pa || !pb) continue;
  const h = getIntlH2H(pa, pb, r.date);

  // Modelo puro (sin blend de cuotas): "lo que el modelo daba" por sí mismo.
  const res = predict(pa, pb, h, 'goals', { useOdds: false });
  const o = res.goals.outcome;
  let p = [o.winA / 100, o.draw / 100, o.winB / 100];
  const s = p[0] + p[1] + p[2];
  if (s > 0) p = p.map((x) => x / s);

  const hs = Number(r.home_score), as = Number(r.away_score);
  const actual = hs > as ? 0 : hs === as ? 1 : 2;

  const pAct = Math.max(1e-9, p[actual]);
  ll += -Math.log(pAct);
  for (let i = 0; i < 3; i++) { const y = i === actual ? 1 : 0; brier += (p[i] - y) ** 2; }
  const pred = p.indexOf(Math.max(...p));
  const hit = pred === actual;
  if (hit) correct++;
  sumConf += p[pred];
  n++;

  // Contraste con el mercado, SOLO si quedó cuota para ese cruce en el snapshot (los partidos pasados
  // suelen haber sido sobrescritos por el último import:odds → ahí no hay comparación).
  const mkt = marketProbsForIds(idA, idB);
  let mktStr = '   —    ';
  if (mkt) {
    let pm = [mkt.winA, mkt.draw, mkt.winB];
    const sm = pm[0] + pm[1] + pm[2];
    if (sm > 0) pm = pm.map((x) => x / sm);
    llMkt += -Math.log(Math.max(1e-9, pm[actual]));
    if (pm.indexOf(Math.max(...pm)) === actual) correctMkt++;
    nMkt++;
    mktStr = `${padL((pm[0] * 100).toFixed(0), 2)}/${padL((pm[1] * 100).toFixed(0), 2)}/${padL((pm[2] * 100).toFixed(0), 2)}`;
  }

  tableRows.push({
    date: r.date.slice(5),
    cross: `${pad(r.home, 14)} ${hs}-${as} ${pad(r.away, 14)}`,
    probs: `${padL(o.winA, 2)}/${padL(o.draw, 2)}/${padL(o.winB, 2)}`,
    xg: `${res.goals.lambdaA.toFixed(1)}-${res.goals.lambdaB.toFixed(1)}`,
    real: RES[actual],
    pAct: `${(pAct * 100).toFixed(0)}%`,
    hit: hit ? '✓' : '✗',
    mkt: mktStr,
  });
}

console.log(`\nReporte Jornada 1 — Mundial 2026  (${n} partidos jugados, mundialista vs mundialista)\n`);
console.log(`  fecha  partido (real)                            mod 1/X/2  xG       res  P(real) ok  mkt 1/X/2`);
console.log('  ' + '-'.repeat(96));
for (const t of tableRows) {
  console.log(`  ${t.date}  ${t.cross}  ${t.probs}  ${pad(t.xg, 7)}  ${t.real}    ${padL(t.pAct, 4)}  ${t.hit}   ${t.mkt}`);
}

const logloss = ll / n, brierAvg = brier / n, acc = correct / n, conf = sumConf / n;
console.log('\n  Agregados del modelo (J1):');
console.log(`    log-loss : ${logloss.toFixed(4)}   (más bajo = mejor; azar 1X2 ≈ 1.0986)`);
console.log(`    Brier    : ${brierAvg.toFixed(4)}`);
console.log(`    acierto  : ${(acc * 100).toFixed(1)}%  (favorito = resultado real, ${correct}/${n})`);
console.log(`    confianza media del favorito: ${(conf * 100).toFixed(1)}%`);
if (nMkt > 0) {
  console.log(`\n  Mercado (en los ${nMkt} partidos con cuota disponible):`);
  console.log(`    log-loss : ${(llMkt / nMkt).toFixed(4)}   acierto: ${(correctMkt / nMkt * 100).toFixed(1)}%`);
} else {
  console.log('\n  Mercado: sin cuotas para estos partidos en el snapshot actual (se sobrescriben al importar la jornada siguiente).');
}

// Lectura honesta automática.
console.log('\n  Lectura:');
if (acc >= 0.6 && conf < 0.5) {
  console.log('    El favorito acertó seguido pero con probabilidades tibias (confianza < 50%): el modelo');
  console.log('    apunta bien al ganador pero no se anima a marcarlo. Coherente con el síntoma "tibio".');
} else if (acc < 0.5) {
  console.log('    El favorito falló en más de la mitad: muestra chica, pero conviene revisar si hubo sorpresas.');
} else {
  console.log('    Comportamiento razonable para una muestra tan chica; sin señal fuerte para cambiar nada.');
}
console.log('    Nota: muestra chica (≈20 partidos) → es señal/cordura, no prueba estadística.');
console.log('    Nota: las predicciones usan perfiles as-of (sin la fila del partido), pero los params');
console.log('    Elo/att-def son el snapshot global ya recalculado con la J1 (misma convención que backtest).\n');

process.exit(0);
