// Pesos del modelo (versión estática para GitHub Pages). Mismos valores que el server.
export const config = {
  homeAdvantage: 0,
  formWeight: 0.25,
  h2hWeight: 0.15,
  opponentWeight: 0.6,
  ratingWeight: 0.40,
  recentMatches: 10,
  leagueAverageGoals: 1.35,
};

export const DEFAULT_RATING = 58;
export const REFERENCE_RATING = 75;

const TIERS = [
  { tier: 1, label: 'Elite', min: 84 },
  { tier: 2, label: 'Alta', min: 76 },
  { tier: 3, label: 'Media', min: 68 },
  { tier: 4, label: 'Baja', min: 0 },
];

export function getTier(rating) {
  const t = TIERS.find((x) => rating >= x.min) || TIERS[TIERS.length - 1];
  return { tier: t.tier, label: t.label };
}
