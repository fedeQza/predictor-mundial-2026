// Pesos del modelo (versión estática para GitHub Pages). Mismos valores que el server.
// Pesos calibrados por backtest (npm run tune): la calidad/Elo manda y la forma reciente casi
// no pesa (el rating ya incluye recencia). Estos son los defaults; los sliders los pueden cambiar.
export const config = {
  homeAdvantage: 0,
  formWeight: 0.05,
  h2hWeight: 0.20,
  opponentWeight: 1.0,
  ratingWeight: 0.90,
  recentMatches: 10,
  leagueAverageGoals: 1.35,
  // Correccion Dixon-Coles (empates/marcadores bajos). Calibrado por backtest (npm run backtest).
  dcRho: -0.05,
  // Temperatura de calibracion W/D/L (>1 suaviza, <1 agudiza). Calibrada por backtest.
  probTemp: 1.0,
  // Modelo Dixon-Coles de ataque/defensa (MLE): si data/dcParams.json está, los goles esperados
  // salen de ahí en vez de la receta heurística. Validado por backtest (log-loss 1.053 -> 0.996).
  useDcModel: true,
  // Cuotas del mercado: si data/odds.json está, el 1X2 se mezcla con el mercado. oddsWeight = cuánto
  // pesa el mercado (0.6 = 60%). La web solo lee el snapshot, nunca consume la API.
  useOdds: true,
  oddsWeight: 0.6,
};

// Escala de ratings 0-1000 (los ratings vienen de data/ratings.json en esa escala).
export const DEFAULT_RATING = 580;
export const REFERENCE_RATING = 750;

const TIERS = [
  { tier: 1, label: 'Elite', min: 840 },
  { tier: 2, label: 'Alta', min: 760 },
  { tier: 3, label: 'Media', min: 680 },
  { tier: 4, label: 'Baja', min: 0 },
];

export function getTier(rating) {
  const t = TIERS.find((x) => rating >= x.min) || TIERS[TIERS.length - 1];
  return { tier: t.tier, label: t.label };
}
