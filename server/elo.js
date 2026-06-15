// Cálculo de los ratings Elo (parametrizable) desde el historial de resultados.
// Lo usan computeRatings.mjs (genera data/ratings.json) y tuneElo.mjs (busca los mejores params).

import { WORLD_CUP_TEAMS } from './worldCupTeams.js';
import { repoNameToId } from './intlResults.js';
import { getRating } from './ratings.js';

// Hiperparámetros por defecto (calibrados con npm run tune:elo).
export const DEFAULT_ELO_PARAMS = { kScale: 1.0, decay: 0.045, hfa: 100, blend: 0.5 };

// Importancia (K base) por tipo de torneo: un Mundial pesa más que un amistoso.
function kBase(tournament) {
  const t = (tournament || '').toLowerCase();
  if (t.includes('world cup') && !t.includes('qualif')) return 60;
  if (/(euro|copa am|cup of nations|asian cup|gold cup|nations league|confederations)/.test(t) && !t.includes('qualif')) return 50;
  if (t.includes('qualif')) return 40;
  if (t === 'friendly') return 20;
  return 30;
}
function eloExpected(rA, rB) { return 1 / (1 + 10 ** ((rB - rA) / 400)); }

// playedRows: partidos jugados (con score), ORDENADOS ascendente por fecha.
// Devuelve { byId (48), byName (~todas), raw (Map nombre->elo), topElo }.
export function computeEloRatings(playedRows, params = {}) {
  const { kScale, decay, hfa, blend } = { ...DEFAULT_ELO_PARAMS, ...params };
  const now = Date.now();
  const elo = new Map();
  const games = new Map();
  const get = (n) => (elo.has(n) ? elo.get(n) : 1500);

  for (const r of playedRows) {
    const hs = Number(r.home_score), as = Number(r.away_score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const homeAdv = r.neutral === 'TRUE' ? 0 : hfa;
    const rh = get(r.home_team), ra = get(r.away_team);
    const eh = eloExpected(rh + homeAdv, ra);
    const sh = hs > as ? 1 : hs === as ? 0.5 : 0;
    const gd = Math.abs(hs - as);
    const gmult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
    const ageYears = (now - new Date(r.date).getTime()) / (365.25 * 24 * 3600 * 1000);
    const recency = Math.max(0.4, 1 - ageYears * decay);
    const k = kBase(r.tournament) * kScale * gmult * recency;
    elo.set(r.home_team, rh + k * (sh - eh));
    elo.set(r.away_team, ra + k * ((1 - sh) - (1 - eh)));
    games.set(r.home_team, (games.get(r.home_team) || 0) + 1);
    games.set(r.away_team, (games.get(r.away_team) || 0) + 1);
  }

  // Mapeo Elo -> escala 0-1000 (anclas: 1300->450; topElo->920).
  const eligible = [...elo.entries()].filter(([n]) => (games.get(n) || 0) >= 20);
  const topElo = Math.max(...eligible.map(([, v]) => v));
  const LO_ELO = 1300, LO_R = 450, HI_R = 920;
  const slope = (HI_R - LO_R) / (topElo - LO_ELO);
  const toRating = (e) => Math.max(420, Math.min(940, Math.round(LO_R + (e - LO_ELO) * slope)));

  const byName = {};
  for (const [n, e] of elo.entries()) if ((games.get(n) || 0) >= 8) byName[n] = toRating(e);

  // Mezcla con el prior hand-tuned (corrige el sesgo del Elo crudo entre confederaciones).
  const blendRating = (eloScaled, id) => {
    const prior = getRating(id); // ya 0-1000
    return Math.max(420, Math.min(940, Math.round(blend * eloScaled + (1 - blend) * prior)));
  };
  const idToName = new Map();
  for (const n of elo.keys()) { const id = repoNameToId(n); if (id != null) idToName.set(id, n); }
  const byId = {};
  for (const t of WORLD_CUP_TEAMS) {
    const n = idToName.get(t.id);
    if (n) {
      const bl = blendRating(toRating(elo.get(n)), t.id);
      byId[t.id] = bl;
      byName[n] = bl;
    }
  }
  return { byId, byName, raw: elo, topElo, idToName };
}
