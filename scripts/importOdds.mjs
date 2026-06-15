// Baja un SNAPSHOT de cuotas 1X2 del Mundial desde The Odds API y lo escribe en data/odds.json
// (+ copia a docs/data/). Es lo ÚNICO que pega a la API: la web y el server solo leen el snapshot.
// Correr a mano cuando haga falta (ahora: fase de grupos; después: cuando se definan los cruces).
//
// Uso:  npm run import:odds                 (region eu, mercado h2h = 1X2)
//       npm run import:odds -- --region uk
//
// Requiere ODDS_API_KEY en .env (registrate gratis en https://the-odds-api.com).
// Costo: 1 crédito por llamada (1 región × 1 mercado). El plan free son ~500/mes.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { DATA_DIR } from '../server/dataset.js';
import { repoNameToId } from '../server/intlResults.js';

const SPORT = 'soccer_fifa_world_cup';
const argRegion = (process.argv.find((a) => a.startsWith('--region=')) || '').split('=')[1];
const REGION = argRegion || (process.argv.includes('--region') ? process.argv[process.argv.indexOf('--region') + 1] : 'eu');
const OUT = path.join(DATA_DIR, 'odds.json');
const DOCS_OUT = path.join(DATA_DIR, '..', 'docs', 'data', 'odds.json');

// Nombres de The Odds API que difieren de nuestro `en` (martj42). Se amplía si el import loguea
// nombres sin mapear. repoNameToId ya cubre la mayoría (Brazil, Germany, United States, etc.).
const ODDS_VARIANTS = {
  'South Korea': 'Korea Republic',
  'North Korea': 'Korea DPR',
  'Ivory Coast': 'Côte d\'Ivoire',
  'Cape Verde': 'Cape Verde Islands',
  'USA': 'United States',
  'DR Congo': 'DR Congo',
  'Czechia': 'Czech Republic',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
};
function nameToId(name) {
  if (!name) return null;
  let id = repoNameToId(name);
  if (id != null) return id;
  const alt = ODDS_VARIANTS[name];
  if (alt) { id = repoNameToId(alt); if (id != null) return id; }
  return null;
}

const key = config.oddsApiKey;
if (!key) {
  console.error('Falta ODDS_API_KEY en .env. Registrate gratis en https://the-odds-api.com y pegá la key.');
  process.exit(1);
}

const url = `https://api.the-odds-api.com/v4/sports/${SPORT}/odds/?apiKey=${key}&regions=${REGION}&markets=h2h&oddsFormat=decimal`;
console.log(`Pidiendo cuotas 1X2 del Mundial (region=${REGION})…`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`Error ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`Cuota de uso -> usados: ${res.headers.get('x-requests-used')}  restantes: ${res.headers.get('x-requests-remaining')}`);
const events = await res.json();
if (!Array.isArray(events) || events.length === 0) {
  console.log('La API no devolvió partidos (puede que no haya fixtures listados todavía).');
}

// De-vig por casa y promedio entre casas.
function consensus(event) {
  let sh = 0, sd = 0, sa = 0, n = 0;
  for (const bk of event.bookmakers || []) {
    const mkt = (bk.markets || []).find((m) => m.key === 'h2h');
    if (!mkt) continue;
    const o = {};
    for (const out of mkt.outcomes || []) o[out.name] = out.price;
    const ph = o[event.home_team], pa = o[event.away_team], pd = o.Draw ?? o.Tie;
    if (!(ph > 0 && pa > 0 && pd > 0)) continue;
    const ih = 1 / ph, id = 1 / pd, ia = 1 / pa, s = ih + id + ia; // s>1 = margen de la casa
    sh += ih / s; sd += id / s; sa += ia / s; n++;
  }
  if (n === 0) return null;
  return { pHome: sh / n, pDraw: sd / n, pAway: sa / n, nBooks: n };
}

const fixtures = [];
const unmatched = new Set();
for (const ev of events || []) {
  const homeId = nameToId(ev.home_team), awayId = nameToId(ev.away_team);
  if (homeId == null) unmatched.add(ev.home_team);
  if (awayId == null) unmatched.add(ev.away_team);
  if (homeId == null || awayId == null) continue;
  const c = consensus(ev);
  if (!c) continue;
  fixtures.push({
    date: (ev.commence_time || '').slice(0, 10),
    homeId, awayId, home: ev.home_team, away: ev.away_team,
    pHome: +c.pHome.toFixed(4), pDraw: +c.pDraw.toFixed(4), pAway: +c.pAway.toFixed(4),
    nBooks: c.nBooks,
  });
}

const payload = { fetchedAt: new Date().toISOString(), region: REGION, sport: SPORT, fixtures };
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 0));
try { fs.writeFileSync(DOCS_OUT, JSON.stringify(payload, null, 0)); } catch { /* docs/data puede no existir */ }

console.log(`\nFixtures con cuotas mapeadas: ${fixtures.length}`);
for (const f of fixtures.slice(0, 12)) {
  console.log(`  ${f.date}  ${f.home} ${(f.pHome * 100).toFixed(0)}% / ${(f.pDraw * 100).toFixed(0)}% / ${(f.pAway * 100).toFixed(0)}% ${f.away}  (${f.nBooks} casas)`);
}
if (unmatched.size) console.log(`\n⚠ Nombres sin mapear (agregalos a ODDS_VARIANTS): ${[...unmatched].join(', ')}`);
console.log(`\nEscrito ${OUT}${fs.existsSync(DOCS_OUT) ? ' (+ docs/data/odds.json)' : ''}.`);
process.exit(0);
