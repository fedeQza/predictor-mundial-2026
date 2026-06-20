// Importa el fixture del Mundial desde un calendario .ics (iCalendar) y escribe data/fixtures.json con
// los horarios REALES de kickoff (UTC). Reemplaza el sembrado placeholder. Saltea los eventos cuyos
// equipos no se resuelven con repoNameToId (placeholders de eliminatorias tipo "Group A Winner",
// playoffs UEFA con selecciones fuera del campo del torneo, etc.) y los reporta.
//
// Uso:
//   node scripts/importFixtures.mjs [url-o-archivo.ics]
//   npm run import:fixtures                      (usa la URL de Sky Sports por defecto)
//   npm run import:fixtures ./mi-calendario.ics  (archivo local)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoNameToId } from '../server/intlResults.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'fixtures.json');
const DEFAULT_URL = 'https://www.skysports.com/calendars/football/fixtures/competitions/fifa-world-cup';

// Nombres del .ics que no coinciden literal con los del repo (martj42). Solo selecciones reales.
const ALIAS = {
  'Korea Republic': 'South Korea',
  'United States of America': 'United States',
  'USA': 'United States',
  'IR Iran': 'Iran',
  "Côte d'Ivoire": 'Ivory Coast',
};
const resolveId = (name) => repoNameToId(name) ?? (ALIAS[name] ? repoNameToId(ALIAS[name]) : null);

function splitTeams(summary) {
  for (const sep of [' vs ', ' v ']) {
    const i = summary.indexOf(sep);
    if (i > 0) return [summary.slice(0, i).trim(), summary.slice(i + sep.length).trim()];
  }
  return null;
}

// "20260611T190000Z" -> "2026-06-11T19:00:00Z". Solo UTC (sufijo Z). Si no trae Z, se asume UTC y avisa.
function icsDateToIso(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}Z`, assumedUtc: !z };
}

// Despliega el line-folding del iCalendar (una linea que empieza con espacio/tab continua la anterior)
// y devuelve los VEVENT como objetos { KEY: value }.
function parseVevents(raw) {
  const lines = raw.split(/\r?\n/);
  const unfolded = [];
  for (const l of lines) {
    if (/^[ \t]/.test(l) && unfolded.length) unfolded[unfolded.length - 1] += l.slice(1);
    else unfolded.push(l);
  }
  const events = [];
  let cur = null;
  for (const l of unfolded) {
    if (l === 'BEGIN:VEVENT') cur = {};
    else if (l === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = l.indexOf(':');
      if (i > 0) cur[l.slice(0, i).split(';')[0]] = l.slice(i + 1);
    }
  }
  return events;
}

async function loadIcs(src) {
  if (/^https?:\/\//i.test(src) || /^webcal:\/\//i.test(src)) {
    const url = src.replace(/^webcal:\/\//i, 'https://');
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`No se pudo bajar el .ics (HTTP ${res.status})`);
    return res.text();
  }
  return fs.readFileSync(path.resolve(src), 'utf8');
}

async function main() {
  const src = process.argv[2] || DEFAULT_URL;
  console.log(`[fixtures] leyendo ${src}`);
  const raw = await loadIcs(src);
  const events = parseVevents(raw);

  const fixtures = [];
  const skipped = [];
  let assumedUtcCount = 0;
  for (const e of events) {
    const summary = e.SUMMARY || '';
    const teams = splitTeams(summary);
    if (!teams) { skipped.push(summary || '(sin SUMMARY)'); continue; }
    const [home, away] = teams;
    if (resolveId(home) == null || resolveId(away) == null) { skipped.push(summary); continue; }
    const dt = e.DTSTART ? icsDateToIso(e.DTSTART) : null;
    if (!dt) { skipped.push(`${summary} (DTSTART invalido: ${e.DTSTART})`); continue; }
    if (dt.assumedUtc) assumedUtcCount++;
    // Guardar el nombre canónico (ya aliaseado) para que el resto del pipeline (notifyMatches ->
    // repoNameToId) lo resuelva directo sin conocer el mapa de alias.
    const canon = (n) => ALIAS[n] || n;
    fixtures.push({ kickoff: dt.iso, home: canon(home), away: canon(away), tournament: 'FIFA World Cup' });
  }

  fixtures.sort((a, b) => (a.kickoff < b.kickoff ? -1 : a.kickoff > b.kickoff ? 1 : 0));

  const out = {
    _note: 'Generado por scripts/importFixtures.mjs desde un .ics. kickoff en UTC ISO. Re-corré npm run import:fixtures para actualizar.',
    source: src,
    updatedAt: new Date().toISOString(),
    fixtures,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  console.log(`[fixtures] escritos ${fixtures.length} partidos en data/fixtures.json (${skipped.length} salteados).`);
  if (assumedUtcCount) console.log(`[fixtures] OJO: ${assumedUtcCount} eventos sin sufijo Z; se asumieron UTC.`);
  // Reporta solo los salteados que NO son placeholders obvios de eliminatorias (por si falta un alias).
  const looksLikePlaceholder = (s) => /Winner|Loser|Second Place|Third Place|Group [A-L]\b|Final|Round of/i.test(s);
  const suspicious = skipped.filter((s) => !looksLikePlaceholder(s));
  if (suspicious.length) {
    console.log('[fixtures] salteados que podrian necesitar un alias (revisar):');
    suspicious.forEach((s) => console.log('   - ' + s));
  }
}

main().catch((err) => { console.error('[fixtures] error:', err); process.exitCode = 1; });
