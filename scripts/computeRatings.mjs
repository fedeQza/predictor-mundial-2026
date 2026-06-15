// Calcula los ratings Elo data-driven (desde 2010, con recencia) y escribe
// data/ratings.json = { byId, byName } en escala 0-1000. Los hiperparámetros del Elo se
// calibran con npm run tune:elo (viven en server/elo.js -> DEFAULT_ELO_PARAMS).
//
// Uso: npm run compute:ratings

import fs from 'node:fs';
import path from 'node:path';
import { WORLD_CUP_TEAMS } from '../server/worldCupTeams.js';
import { DATA_DIR, parseCsv } from '../server/dataset.js';
import { getRating } from '../server/ratings.js';
import { computeEloRatings, DEFAULT_ELO_PARAMS } from '../server/elo.js';

const SOURCE_URL = 'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';
const OUT = path.join(DATA_DIR, 'ratings.json');
const SINCE = '2010-01-01';

async function main() {
  console.log('Descargando historial completo…');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) { console.error(`No se pudo descargar (${res.status}).`); process.exit(1); }
  const rows = parseCsv(await res.text())
    .filter((r) => r.date && r.date >= SINCE && r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '')
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  console.log(`Partidos para el Elo (desde ${SINCE}): ${rows.length}`);

  const { byId, byName, raw, idToName } = computeEloRatings(rows, DEFAULT_ELO_PARAMS);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ byId, byName }, null, 0));

  const p = DEFAULT_ELO_PARAMS;
  console.log(`\nElo params: kScale=${p.kScale} decay=${p.decay} hfa=${p.hfa} blend=${p.blend}\n`);
  const report = WORLD_CUP_TEAMS
    .map((t) => ({ t, e: Math.round(raw.get(idToName.get(t.id)) || 1500), nuevo: byId[t.id], viejo: getRating(t.id) }))
    .sort((x, y) => y.nuevo - x.nuevo);
  for (const r of report) {
    console.log(`  ${String(r.nuevo).padStart(3)} (Elo ${r.e})  ${r.t.name.padEnd(20)} prior:${r.viejo}`);
  }
  console.log(`\nEscrito ${OUT} (byId: ${Object.keys(byId).length}, byName: ${Object.keys(byName).length}).`);
  process.exit(0);
}

main();
