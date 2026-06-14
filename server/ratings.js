// Calidad de cada seleccion (rating ~45-92) y su nivel/grupo (4 tiers).
// Sirve para dos cosas:
//   1) Ponderar los partidos pasados por la calidad del rival (golear a un Elite vale mas).
//   2) Dar un peso directo al rating en los goles esperados.
//
// Las claves son los IDs de API-Football. Incluye las 48 del Mundial y muchas selecciones
// mas (rivales habituales en amistosos/eliminatorias). Los numeros son aproximados y
// editables; lo que importa es el orden relativo.

export const RATINGS = {
  // --- 48 del Mundial ---
  26: 91, 2: 90, 9: 89, 10: 88, 6: 88, 27: 87, 1118: 86, 1: 85, 25: 85, 768: 85,
  3: 84, 7: 84, 8: 82, 31: 82, 12: 81, 13: 80, 15: 80, 21: 80, 1090: 80,
  2384: 79, 16: 79, 775: 79, 14: 78, 17: 78, 2382: 78, 19: 78,
  22: 77, 32: 77, 772: 77, 20: 76, 1501: 76, 1532: 76, 5529: 76,
  1530: 75, 1504: 74, 2380: 74, 28: 73, 1569: 72, 11: 72, 29: 72, 1508: 72,
  23: 71, 1568: 71, 2385: 71, 1567: 70, 2381: 67, 4673: 66, 777: 78,

  // --- UEFA (otras) ---
  24: 77, 769: 77, 1117: 76, 770: 76, 5: 76, 1108: 76, 767: 75, 773: 74, 774: 74,
  1104: 74, 1091: 73, 778: 72, 1113: 72, 18: 70, 776: 70, 1116: 70, 1099: 71,
  1105: 71, 771: 68, 1109: 68, 1111: 68, 1103: 66, 1106: 60, 1102: 62, 1100: 63,
  1094: 64, 1095: 63, 1096: 62, 1101: 58, 1097: 58, 1092: 57, 1114: 58, 1098: 53,
  1112: 55, 1110: 50, 1107: 48, 1093: 48, 1115: 45,

  // --- CONMEBOL (otras) ---
  2383: 75, 2379: 73, 30: 72,

  // --- CAF (otras) ---
  1500: 73, 1502: 72, 1531: 71, 1509: 70, 1533: 68, 1529: 66, 1507: 65, 1492: 64,
  1513: 63, 1489: 62, 1512: 62, 1521: 62, 1491: 60, 1493: 60,

  // --- AFC (otras) ---
  1548: 70, 1563: 67, 1552: 65, 1566: 64, 1565: 63, 1547: 62, 1542: 62, 1536: 62,
  1554: 60, 1551: 60, 1562: 60, 1564: 60, 1537: 58, 1571: 58, 1538: 56, 4460: 52,

  // --- CONCACAF (otras) ---
  4672: 66, 2386: 63, 5168: 62, 5530: 60, 5159: 60, 5161: 60, 2388: 55, 8117: 52,
  10983: 52, 5536: 45,
};

// La escala publica es 0-1000 (mas fina). La tabla RATINGS de arriba esta en 0-100 por
// legibilidad; getRating la expone x10. Los ratings data-driven (data/ratings.json) ya vienen
// en 0-1000, asi que todo el codigo trabaja en esa escala.

// Rating por defecto para una seleccion desconocida (rival no listado).
export const DEFAULT_RATING = 580;

// Rating de referencia (aprox. el promedio de una seleccion de nivel mundialista).
export const REFERENCE_RATING = 750;

export function getRating(id) {
  const base = RATINGS[Number(id)];
  return base != null ? base * 10 : DEFAULT_RATING;
}

// Cuatro niveles/grupos de calidad (escala 0-1000).
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

export function getQuality(id) {
  const rating = getRating(id);
  const { tier, label } = getTier(rating);
  return { rating, tier, tierLabel: label };
}
