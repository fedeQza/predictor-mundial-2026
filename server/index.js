// Servidor Express: sirve el frontend estatico y expone la API interna.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getTeamsList, getTeamProfile, getH2H, fetchTeamStats } from './dataService.js';
import { predict, SUPPORTED_METRICS } from './model.js';
import { datasetSize } from './dataset.js';
import { hasData as intlHasData } from './intlResults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

// Frontend estatico.
app.use(express.static(PUBLIC_DIR));

// Estado de la app (modo demo o datos reales).
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    demoMode: config.demoMode,
    metrics: SUPPORTED_METRICS,
  });
});

// Lista de las 48 selecciones para los desplegables.
app.get('/api/teams', (req, res) => {
  res.json({ teams: getTeamsList() });
});

// Prediccion principal.
app.get('/api/predict', async (req, res) => {
  const { teamA, teamB } = req.query;
  const metric = req.query.metric || 'goals';

  if (!teamA || !teamB) {
    return res.status(400).json({ error: 'Faltan los parametros teamA y teamB.' });
  }

  try {
    // Se piden los perfiles en paralelo.
    const [profileA, profileB] = await Promise.all([
      getTeamProfile(teamA),
      getTeamProfile(teamB),
    ]);

    if (profileA.id === profileB.id) {
      return res.status(400).json({ error: 'Elegí dos equipos distintos.' });
    }

    // Si el H2H falla (p.ej. cuota/clave caida en modo live), seguimos sin el: la
    // prediccion se calcula igual con el peso de historial neutro.
    let h2h = { count: 0, avgGoalsA: 0, avgGoalsB: 0, matches: [] };
    try {
      h2h = await getH2H(profileA, profileB);
    } catch (err) {
      console.warn(`[predict] H2H no disponible (${err.message}); se usa historial vacio.`);
    }

    const result = predict(profileA, profileB, h2h, metric);

    res.json({ demoMode: config.demoMode, prediction: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enriquecer con stats detalladas via API-Football (boton "Consultar API").
// El dataset primario (repo) no trae tarjetas/tiros/corners; esto las trae a demanda.
app.get('/api/enrich', async (req, res) => {
  const { teamA, teamB } = req.query;
  if (!teamA || !teamB) {
    return res.status(400).json({ error: 'Faltan los parametros teamA y teamB.' });
  }
  try {
    const [profileA, profileB] = await Promise.all([getTeamProfile(teamA), getTeamProfile(teamB)]);
    // Stats reales desde la API (cuesta cuota; puede fallar si la key esta sin cuota/suspendida).
    const [statsA, statsB] = await Promise.all([fetchTeamStats(teamA), fetchTeamStats(teamB)]);
    const pick = (s) => ({
      shots_on_goal: s.shots_on_goal, total_shots: s.total_shots,
      corners: s.corners, fouls: s.fouls, cards: s.cards,
    });
    profileA.stats = pick(statsA);
    profileB.stats = pick(statsB);

    let h2h = { count: 0, avgGoalsA: 0, avgGoalsB: 0, matches: [] };
    try { h2h = await getH2H(profileA, profileB); } catch { /* H2H opcional */ }

    const result = predict(profileA, profileB, h2h, 'goals');
    const metrics = result.allMetrics.filter((m) => m.key !== 'goals');
    res.json({ metrics, teams: { a: profileA.name, b: profileB.name } });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.listen(config.port, () => {
  let mode = 'datos reales (API-Football)';
  if (config.demoMode) mode = 'MODO DEMO (sin API key)';
  else if (config.useIntl && intlHasData()) mode = 'dataset de resultados (martj42) + API por botón';
  else if (config.useDataset) mode = `dataset local (CSV, ${datasetSize()} equipos)`;
  console.log(`\n  Predictor del Mundial corriendo en http://localhost:${config.port}`);
  console.log(`  Estado: ${mode}\n`);
});
