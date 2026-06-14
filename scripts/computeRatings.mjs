// Calcula un rating data-driven (Elo) para CADA selección a partir del historial real de
// resultados (martj42/international_results), y lo mapea a nuestra escala ~45-94.
// Escribe data/ratings.json = { byId: {<id>:rating}, byName: {<repoName>:rating} }.
//
// Uso: npm run compute:ratings

import fs from 'node:fs';
import path from 'node:path';
import { WORLD_CUP_TEAMS } from '../server/worldCupTeams.js';
import { repoNameToId } from '../server/intlResults.js';
import { DATA_DIR, parseCsv } from '../server/dataset.js';
import { getRating } from '../server/ratings.js';

const SOURCE_URL = 'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';
const OUT = path.join(DATA_DIR, 'ratings.json');

// Importancia (K base) por tipo de torneo: un Mundial pesa más que un amistoso.
function kBase(tournament) {
  const t = (tournament || '').toLowerCase();
  if (t.includes('world cup') && !t.includes('qualif')) return 60;
  if (/(euro|copa am|cup of nations|asian cup|gold cup|nations league|confederations)/.test(t) && !t.includes('qualif')) return 50;
  if (t.includes('qualif')) return 40;
  if (t === 'friendly') return 20;
  return 30;
}

function eloExpected(rA, rB) {
  return 1 / (1 + 10 ** ((rB - rA) / 400));
}

async function main() {
  console.log('Descargando historial completo…');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) { console.error(`No se pudo descargar (${res.status}).`); process.exit(1); }
  const rows = parseCsv(await res.text())
    .filter((r) => r.date && r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '')
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  console.log(`Partidos para el Elo: ${rows.length}`);

  const elo = new Map();
  const games = new Map();
  const get = (n) => (elo.has(n) ? elo.get(n) : 1500);
  const bump = (m, n) => m.set(n, (m.get(n) || 0) + 1);

  for (const r of rows) {
    const h = r.home_team, a = r.away_team;
    const hs = Number(r.home_score), as = Number(r.away_score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const hfa = r.neutral === 'TRUE' ? 0 : 100; // ventaja de local en puntos Elo
    const rh = get(h), ra = get(a);
    const eh = eloExpected(rh + hfa, ra);
    const sh = hs > as ? 1 : hs === as ? 0.5 : 0;
    const gd = Math.abs(hs - as);
    const gmult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8; // peso por diferencia de goles
    const k = kBase(r.tournament) * gmult;
    elo.set(h, rh + k * (sh - eh));
    elo.set(a, ra + k * ((1 - sh) - (1 - eh)));
    bump(games, h); bump(games, a);
  }

  // Calibración del mapeo Elo -> escala 45-94. Anclas: elo 1300 -> 45; topElo -> 92.
  const eligible = [...elo.entries()].filter(([n]) => (games.get(n) || 0) >= 20);
  const topElo = Math.max(...eligible.map(([, v]) => v));
  const LO_ELO = 1300, LO_R = 45, HI_R = 92;
  const slope = (HI_R - LO_R) / (topElo - LO_ELO);
  const toRating = (e) => Math.max(42, Math.min(94, Math.round(LO_R + (e - LO_ELO) * slope)));

  const byName = {};
  for (const [n, e] of elo.entries()) {
    if ((games.get(n) || 0) >= 8) byName[n] = toRating(e);
  }
  // byId para las 48 (invirtiendo repoNameToId sobre los nombres del repo).
  const idToName = new Map();
  for (const n of elo.keys()) { const id = repoNameToId(n); if (id != null) idToName.set(id, n); }
  const byId = {};
  for (const t of WORLD_CUP_TEAMS) {
    const n = idToName.get(t.id);
    if (n) byId[t.id] = toRating(elo.get(n));
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ byId, byName }, null, 0));

  // Reporte: las 48 ordenadas, nuevo vs viejo.
  console.log(`\ntopElo=${Math.round(topElo)} -> rating 92.  Escala: elo ${LO_ELO}->45.\n`);
  const report = WORLD_CUP_TEAMS
    .map((t) => ({ t, n: idToName.get(t.id), e: Math.round(elo.get(idToName.get(t.id)) || 1500), nuevo: byId[t.id], viejo: getRating(t.id) }))
    .sort((x, y) => y.nuevo - x.nuevo);
  for (const r of report) {
    console.log(`  ${String(r.nuevo).padStart(2)} (Elo ${r.e})  ${r.t.name.padEnd(20)} viejo:${r.viejo}`);
  }
  console.log(`\nEscrito ${OUT} (byId: 48, byName: ${Object.keys(byName).length} selecciones).`);
  process.exit(0);
}

main();
