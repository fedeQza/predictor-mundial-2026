// Dispatcher de "datos actuales": elige el/los proveedor(es) de overlay 2026 segun
// config.dataSource, y aisla a dataService de cual esta activo. Todos comparten el contrato:
//   getCurrentData(apiFootballId, enName) -> {source, latest, next} | null

import { config } from './config.js';
import { getCurrentData as apiFootballCurrent } from './apiFootballCurrent.js';
import { getCurrentData as tsdbCurrent } from './theSportsDb.js';
import { getCurrentData as rapidCurrent } from './soccerData6.js';

// Combina dos resultados: prioriza el `latest` del primario (stats completas) y completa
// `next` con el secundario si al primario le falta. Devuelve null si ninguno aporto nada.
function combine(primary, secondary) {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;
  return {
    source: primary.latest ? primary.source : secondary.source,
    latest: primary.latest || secondary.latest,
    next: primary.next || secondary.next,
  };
}

export async function getCurrentData(apiFootballId, enName) {
  switch (config.dataSource) {
    case 'hybrid': {
      // API-Football propio primero (stats completas + id de rival exacto); TheSportsDB de
      // respaldo (siempre tiene el ultimo partido, aunque sea de hace dias o fuera de la ventana).
      const live = await apiFootballCurrent(apiFootballId, enName);
      if (live && live.latest && live.next) return live; // ya esta completo
      const tsdb = await tsdbCurrent(apiFootballId, enName);
      return combine(live, tsdb);
    }
    case 'apifootball-live':
      return apiFootballCurrent(apiFootballId, enName);
    case 'thesportsdb':
      return tsdbCurrent(apiFootballId, enName);
    case 'rapidapi':
      return rapidCurrent(apiFootballId, enName);
    case 'apifootball':
    default:
      return null; // sin overlay: solo la base de API-Football
  }
}
