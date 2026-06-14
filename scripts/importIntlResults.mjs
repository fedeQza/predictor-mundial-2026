// Descarga el dataset de resultados de selecciones de martj42/international_results y guarda
// el subconjunto que nos sirve: partidos desde 2010 que involucran a algún mundialista
// (incluye las filas futuras con score NA, para el "próximo partido").
//
// Reusa el parser/escritor CSV de server/dataset.js. Re-ejecutable para refrescar.
// Uso: npm run import:intl

import fs from 'node:fs';
import { WORLD_CUP_TEAMS } from '../server/worldCupTeams.js';
import { DATA_DIR, parseCsv, toCsv } from '../server/dataset.js';
import { repoNameToId, INTL_RESULTS_CSV, INTL_HEADER } from '../server/intlResults.js';

const SOURCE_URL = 'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';
const SINCE = '2010-01-01';

async function main() {
  console.log('Descargando results.csv del repo…');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    console.error(`No se pudo descargar (${res.status}).`);
    process.exit(1);
  }
  const text = await res.text();
  const all = parseCsv(text);
  console.log(`Total filas en el repo: ${all.length}`);

  const out = [];
  for (const r of all) {
    if (!r.date || r.date < SINCE) continue;
    const homeId = repoNameToId(r.home_team);
    const awayId = repoNameToId(r.away_team);
    if (homeId == null && awayId == null) continue; // no involucra a ningún mundialista
    out.push({
      date: r.date,
      home: r.home_team,
      away: r.away_team,
      home_score: r.home_score,
      away_score: r.away_score,
      tournament: r.tournament,
      neutral: r.neutral,
    });
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INTL_RESULTS_CSV, toCsv(INTL_HEADER, out));

  const played = out.filter((r) => r.home_score !== 'NA' && r.away_score !== 'NA');
  const future = out.length - played.length;
  const teamsWithData = new Set();
  out.forEach((r) => {
    const a = repoNameToId(r.home); const b = repoNameToId(r.away);
    if (a != null) teamsWithData.add(a);
    if (b != null) teamsWithData.add(b);
  });
  console.log(`\nGuardado: ${out.length} filas (${played.length} jugadas, ${future} futuras NA) en`);
  console.log(`  ${INTL_RESULTS_CSV}`);
  console.log(`Mundialistas con datos: ${teamsWithData.size}/48`);
  const missing = WORLD_CUP_TEAMS.filter((t) => !teamsWithData.has(t.id));
  if (missing.length) console.log(`Sin datos: ${missing.map((t) => t.name).join(', ')}`);
  process.exit(0);
}

main();
