// Cuotas del mercado (1X2) para la versión navegador. NO consume la API: solo lee el snapshot
// data/odds.json (bajado a mano con npm run import:odds). Espejo de server/odds.js.

let fixtures = [];

export function setOdds(j) { fixtures = (j && Array.isArray(j.fixtures)) ? j.fixtures : []; }
export function hasOddsData() { return fixtures.length > 0; }

// Probabilidades de mercado (fracciones 0-1) para A vs B, o null si no hay cuotas para ese par.
export function marketProbsForIds(idA, idB) {
  const a = Number(idA), b = Number(idB);
  const f = fixtures.find((x) => (x.homeId === a && x.awayId === b) || (x.homeId === b && x.awayId === a));
  if (!f) return null;
  if (f.homeId === a) return { winA: f.pHome, draw: f.pDraw, winB: f.pAway, nBooks: f.nBooks, date: f.date };
  return { winA: f.pAway, draw: f.pDraw, winB: f.pHome, nBooks: f.nBooks, date: f.date };
}
