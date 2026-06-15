// Lee la configuracion desde variables de entorno (cargadas con `node --env-file=.env`).
// Si una variable no esta definida, usa un valor por defecto razonable.

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const apiKey = (process.env.APIFOOTBALL_KEY || '').trim();
const demoMode = apiKey.length === 0;
const rapidApiKey = (process.env.RAPIDAPI_KEY || '').trim();

export const config = {
  // Si no hay API key, la app funciona con datos ficticios (modo demo).
  apiKey,
  demoMode,

  port: num(process.env.PORT, 3000),

  apiBaseUrl: 'https://v3.football.api-sports.io',

  // --- Datos actuales (overlay 2026) -------------------------------------------
  // La base de la muestra es API-Football `season=2024`. Para selecciones, "season" es el
  // ciclo de la competencia, no el ano: las Eliminatorias 2026 estan bajo season=2024, asi
  // que la base llega hasta 2025 e incluso marzo-2026 (el numero 2025/2026 SI esta bloqueado
  // por el plan Free, pero estos partidos figuran como 2024). Ademas, el plan Free permite una
  // ventana movil de ~3 dias (ayer/hoy/manana) via el parametro
  // `date`, que durante el Mundial trae partidos de 2026 con stats completas. Sobre esa
  // base superponemos el ultimo partido de 2026 + el proximo rival desde una fuente
  // intercambiable:
  //   'hybrid'          -> API-Football-live (stats completas) + TheSportsDB de respaldo (default)
  //   'apifootball-live'-> solo la ventana de fechas de API-Football
  //   'thesportsdb'     -> solo TheSportsDB (key gratis "3", sin registro)
  //   'rapidapi'        -> soccer-data6 (requiere RAPIDAPI_KEY)
  //   'apifootball'     -> sin overlay (solo la base de API-Football)
  dataSource: (process.env.DATA_SOURCE || (demoMode ? 'apifootball' : 'hybrid')).trim(),

  // TheSportsDB: key publica de demo "3" por defecto.
  tsdbKey: (process.env.THESPORTSDB_KEY || '3').trim(),
  tsdbBaseUrl: 'https://www.thesportsdb.com/api/v1/json',

  // soccer-data6 (RapidAPI): vacio = desactivado. El host exacto se confirma en el
  // dashboard de RapidAPI al suscribirse.
  rapidApiKey,
  rapidApiHost: (process.env.RAPIDAPI_HOST || 'soccer-data6.p.rapidapi.com').trim(),

  // --- Dataset local (CSV) ------------------------------------------------------
  // Con USE_DATASET=1 la app consume los perfiles desde data/teams.csv + data/matches.csv
  // (0 llamadas a API-Football). Se genera con `npm run build:dataset`.
  useDataset: ['1', 'true', 'yes'].includes((process.env.USE_DATASET || '').trim().toLowerCase()),

  // --- Fuente primaria: dataset de resultados (martj42/international_results) -----
  // ON por defecto: si data/international_results.csv existe (npm run import:intl), los
  // perfiles y el H2H salen de ahi (goles/forma/historial real, sin tocar la API). La API
  // queda solo para las stats detalladas via el boton "Consultar API". USE_INTL=0 lo apaga.
  useIntl: (process.env.USE_INTL ?? '1').trim() !== '0',

  // Parametros del modelo (ver .env.example).
  homeAdvantage: num(process.env.HOME_ADVANTAGE, 0),
  // Defaults calibrados por backtest (npm run tune): la calidad/Elo pesa fuerte y la forma
  // reciente casi nada (el rating ya incluye recencia, asi que la forma era redundante).
  formWeight: num(process.env.FORM_WEIGHT, 0.05),
  h2hWeight: num(process.env.H2H_WEIGHT, 0.20),

  // Cuanto pondera la calidad del rival al promediar los partidos pasados.
  // 0 = no importa contra quien jugo; valores altos = ajuste pleno (incluso >1).
  opponentWeight: num(process.env.OPPONENT_WEIGHT, 1.0),
  // Peso directo de la diferencia de rating entre los dos equipos sobre los goles esperados.
  ratingWeight: num(process.env.RATING_WEIGHT, 0.90),
  recentMatches: num(process.env.RECENT_MATCHES, 10),
  statsMatches: num(process.env.STATS_MATCHES, 3),

  // Temporadas a consultar (el plan gratuito de API-Football NO admite el parametro `last`
  // y cubre solo hasta ~2023, asi que pedimos por temporada y combinamos). Mas reciente primero.
  seasons: (process.env.SEASONS || '2024,2023')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n)),

  // Promedio global de goles por equipo y por partido (baseline tipico del futbol).
  // Se usa como ancla para no sobre-reaccionar a muestras chicas.
  leagueAverageGoals: 1.35,

  // Correccion Dixon-Coles para marcadores bajos (rho). El Poisson independiente subestima
  // empates 0-0/1-1; rho<0 lo corrige. Valor calibrado por backtest (npm run backtest). 0 = off.
  dcRho: num(process.env.DC_RHO, -0.05),
};
