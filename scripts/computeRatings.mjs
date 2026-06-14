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
const SINCE = '2010-01-01';

// Peso por recencia: los partidos recientes valen mas (refleja "que tan bien esta HOY").
// Un partido de hace ~13 años pesa ~0.4; uno de este año, 1.0.
function recencyWeight(dateStr) {
  const ageYears = (Date.now() - new Date(dateStr).getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0.4, 1 - ageYears * 0.045);
}

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
    .filter((r) => r.date && r.date >= SINCE && r.home_score !== 'NA' && r.away_score !== 'NA' && r.home_score !== '')
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  console.log(`Partidos para el Elo (desde ${SINCE}): ${rows.length}`);

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
    const k = kBase(r.tournament) * gmult * recencyWeight(r.date);
    elo.set(h, rh + k * (sh - eh));
    elo.set(a, ra + k * ((1 - sh) - (1 - eh)));
    bump(games, h); bump(games, a);
  }

  // Calibración del mapeo Elo -> escala 0-1000. Anclas: elo 1300 -> 450; topElo -> 920.
  const eligible = [...elo.entries()].filter(([n]) => (games.get(n) || 0) >= 20);
  const topElo = Math.max(...eligible.map(([, v]) => v));
  const LO_ELO = 1300, LO_R = 450, HI_R = 920;
  const slope = (HI_R - LO_R) / (topElo - LO_ELO);
  const toRating = (e) => Math.max(420, Math.min(940, Math.round(LO_R + (e - LO_ELO) * slope)));

  const byName = {};
  for (const [n, e] of elo.entries()) {
    if ((games.get(n) || 0) >= 8) byName[n] = toRating(e);
  }
  // Mezcla Elo (forma, data-driven) con el prior hand-tuned de ratings.js (calibración global
  // entre confederaciones). El Elo "crudo" infla a equipos que juegan aislados en su confederación
  // (p.ej. AFC), así que el prior corrige eso. BLEND: 0 = solo prior, 1 = solo Elo.
  const BLEND = 0.5;
  const blendRating = (eloScaled, id) => {
    const prior = getRating(id); // ya en escala 0-1000 (getRating expone x10)
    return Math.max(420, Math.min(940, Math.round(BLEND * eloScaled + (1 - BLEND) * prior)));
  };

  // byId para las 48 (invirtiendo repoNameToId sobre los nombres del repo).
  const idToName = new Map();
  for (const n of elo.keys()) { const id = repoNameToId(n); if (id != null) idToName.set(id, n); }
  const byId = {};
  for (const t of WORLD_CUP_TEAMS) {
    const n = idToName.get(t.id);
    if (n) {
      const blended = blendRating(toRating(elo.get(n)), t.id);
      byId[t.id] = blended;
      byName[n] = blended; // consistencia: mismo valor cuando el mundialista es rival de otro
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ byId, byName }, null, 0));

  // Reporte: las 48 ordenadas, nuevo vs viejo.
  console.log(`\ntopElo=${Math.round(topElo)} -> ${HI_R}.  Escala 0-1000 (elo ${LO_ELO} -> ${LO_R}). Mezcla ${BLEND} Elo / ${(1 - BLEND).toFixed(2)} prior.\n`);
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
