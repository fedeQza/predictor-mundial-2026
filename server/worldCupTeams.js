// Las 48 selecciones del Mundial 2026, con sus IDs reales de API-Football.
// Usar el ID como valor del desplegable elimina la ambiguedad de nombres.
//
// La lista refleja las 48 plazas esperadas (16 UEFA, 6 CONMEBOL, 9 CAF, 8 AFC,
// 6 CONCACAF, 1 OFC, 2 repechaje). Es facil de editar: cambiá cualquier { id, name }
// por otra seleccion; mientras el id sea el de API-Football, las predicciones funcionan.

// El campo `en` es el nombre en ingles que usan TheSportsDB / soccer-data6 para buscar
// el equipo (luego se cruza por idAPIfootball). Editable junto al resto.
export const WORLD_CUP_TEAMS = [
  // UEFA (16)
  { id: 2, name: 'Francia', en: 'France', conf: 'UEFA' },
  { id: 9, name: 'España', en: 'Spain', conf: 'UEFA' },
  { id: 10, name: 'Inglaterra', en: 'England', conf: 'UEFA' },
  { id: 27, name: 'Portugal', en: 'Portugal', conf: 'UEFA' },
  { id: 1118, name: 'Países Bajos', en: 'Netherlands', conf: 'UEFA' },
  { id: 25, name: 'Alemania', en: 'Germany', conf: 'UEFA' },
  { id: 3, name: 'Croacia', en: 'Croatia', conf: 'UEFA' },
  { id: 1, name: 'Bélgica', en: 'Belgium', conf: 'UEFA' },
  { id: 15, name: 'Suiza', en: 'Switzerland', conf: 'UEFA' },
  { id: 775, name: 'Austria', en: 'Austria', conf: 'UEFA' },
  { id: 777, name: 'Turquía', en: 'Turkey', conf: 'UEFA' },
  { id: 1090, name: 'Noruega', en: 'Norway', conf: 'UEFA' },
  { id: 1108, name: 'Escocia', en: 'Scotland', conf: 'UEFA' },
  { id: 5, name: 'Suecia', en: 'Sweden', conf: 'UEFA' },
  { id: 770, name: 'Chequia', en: 'Czech Republic', conf: 'UEFA' },
  { id: 1113, name: 'Bosnia y Herzegovina', en: 'Bosnia and Herzegovina', conf: 'UEFA' },

  // CONMEBOL (6)
  { id: 26, name: 'Argentina', en: 'Argentina', conf: 'CONMEBOL' },
  { id: 6, name: 'Brasil', en: 'Brazil', conf: 'CONMEBOL' },
  { id: 7, name: 'Uruguay', en: 'Uruguay', conf: 'CONMEBOL' },
  { id: 8, name: 'Colombia', en: 'Colombia', conf: 'CONMEBOL' },
  { id: 2382, name: 'Ecuador', en: 'Ecuador', conf: 'CONMEBOL' },
  { id: 2380, name: 'Paraguay', en: 'Paraguay', conf: 'CONMEBOL' },

  // CAF (9)
  { id: 31, name: 'Marruecos', en: 'Morocco', conf: 'CAF' },
  { id: 13, name: 'Senegal', en: 'Senegal', conf: 'CAF' },
  { id: 32, name: 'Egipto', en: 'Egypt', conf: 'CAF' },
  { id: 1532, name: 'Argelia', en: 'Algeria', conf: 'CAF' },
  { id: 1501, name: 'Costa de Marfil', en: 'Ivory Coast', conf: 'CAF' },
  { id: 1504, name: 'Ghana', en: 'Ghana', conf: 'CAF' },
  { id: 28, name: 'Túnez', en: 'Tunisia', conf: 'CAF' },
  { id: 1533, name: 'Cabo Verde', en: 'Cape Verde', conf: 'CAF' },
  { id: 1531, name: 'Sudáfrica', en: 'South Africa', conf: 'CAF' },

  // AFC (8)
  { id: 12, name: 'Japón', en: 'Japan', conf: 'AFC' },
  { id: 17, name: 'Corea del Sur', en: 'South Korea', conf: 'AFC' },
  { id: 22, name: 'Irán', en: 'Iran', conf: 'AFC' },
  { id: 20, name: 'Australia', en: 'Australia', conf: 'AFC' },
  { id: 23, name: 'Arabia Saudita', en: 'Saudi Arabia', conf: 'AFC' },
  { id: 1569, name: 'Catar', en: 'Qatar', conf: 'AFC' },
  { id: 1568, name: 'Uzbekistán', en: 'Uzbekistan', conf: 'AFC' },
  { id: 1548, name: 'Jordania', en: 'Jordan', conf: 'AFC' },

  // CONCACAF (6, incluye anfitriones USA/Mexico/Canada)
  { id: 2384, name: 'Estados Unidos', en: 'USA', conf: 'CONCACAF' },
  { id: 16, name: 'México', en: 'Mexico', conf: 'CONCACAF' },
  { id: 5529, name: 'Canadá', en: 'Canada', conf: 'CONCACAF' },
  { id: 5530, name: 'Curazao', en: 'Curacao', conf: 'CONCACAF' },
  { id: 2386, name: 'Haití', en: 'Haiti', conf: 'CONCACAF' },
  { id: 11, name: 'Panamá', en: 'Panama', conf: 'CONCACAF' },

  // OFC (1)
  { id: 4673, name: 'Nueva Zelanda', en: 'New Zealand', conf: 'OFC' },

  // Repechaje intercontinental (2 ganadores de la repesca)
  { id: 1567, name: 'Irak', en: 'Iraq', conf: 'Repechaje' },
  { id: 1508, name: 'Congo RD', en: 'Congo DR', conf: 'Repechaje' },
];

// Mapa rapido id -> equipo.
export const TEAM_BY_ID = new Map(WORLD_CUP_TEAMS.map((t) => [t.id, t]));

export function getTeamName(id) {
  return TEAM_BY_ID.get(Number(id))?.name || String(id);
}

// Nombre en ingles (para buscar en TheSportsDB / soccer-data6). Cae al nombre normal.
export function getTeamEn(id) {
  const t = TEAM_BY_ID.get(Number(id));
  return t?.en || t?.name || String(id);
}
