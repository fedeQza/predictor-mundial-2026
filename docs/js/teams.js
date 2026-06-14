// Las 48 selecciones del Mundial 2026 (generado desde server/worldCupTeams.js).
export const WORLD_CUP_TEAMS = [
  { id: 2, name: "Francia", en: "France", conf: "UEFA" },
  { id: 9, name: "España", en: "Spain", conf: "UEFA" },
  { id: 10, name: "Inglaterra", en: "England", conf: "UEFA" },
  { id: 27, name: "Portugal", en: "Portugal", conf: "UEFA" },
  { id: 1118, name: "Países Bajos", en: "Netherlands", conf: "UEFA" },
  { id: 25, name: "Alemania", en: "Germany", conf: "UEFA" },
  { id: 3, name: "Croacia", en: "Croatia", conf: "UEFA" },
  { id: 1, name: "Bélgica", en: "Belgium", conf: "UEFA" },
  { id: 15, name: "Suiza", en: "Switzerland", conf: "UEFA" },
  { id: 775, name: "Austria", en: "Austria", conf: "UEFA" },
  { id: 777, name: "Turquía", en: "Turkey", conf: "UEFA" },
  { id: 1090, name: "Noruega", en: "Norway", conf: "UEFA" },
  { id: 1108, name: "Escocia", en: "Scotland", conf: "UEFA" },
  { id: 5, name: "Suecia", en: "Sweden", conf: "UEFA" },
  { id: 770, name: "Chequia", en: "Czech Republic", conf: "UEFA" },
  { id: 1113, name: "Bosnia y Herzegovina", en: "Bosnia and Herzegovina", conf: "UEFA" },
  { id: 26, name: "Argentina", en: "Argentina", conf: "CONMEBOL" },
  { id: 6, name: "Brasil", en: "Brazil", conf: "CONMEBOL" },
  { id: 7, name: "Uruguay", en: "Uruguay", conf: "CONMEBOL" },
  { id: 8, name: "Colombia", en: "Colombia", conf: "CONMEBOL" },
  { id: 2382, name: "Ecuador", en: "Ecuador", conf: "CONMEBOL" },
  { id: 2380, name: "Paraguay", en: "Paraguay", conf: "CONMEBOL" },
  { id: 31, name: "Marruecos", en: "Morocco", conf: "CAF" },
  { id: 13, name: "Senegal", en: "Senegal", conf: "CAF" },
  { id: 32, name: "Egipto", en: "Egypt", conf: "CAF" },
  { id: 1532, name: "Argelia", en: "Algeria", conf: "CAF" },
  { id: 1501, name: "Costa de Marfil", en: "Ivory Coast", conf: "CAF" },
  { id: 1504, name: "Ghana", en: "Ghana", conf: "CAF" },
  { id: 28, name: "Túnez", en: "Tunisia", conf: "CAF" },
  { id: 1533, name: "Cabo Verde", en: "Cape Verde", conf: "CAF" },
  { id: 1531, name: "Sudáfrica", en: "South Africa", conf: "CAF" },
  { id: 12, name: "Japón", en: "Japan", conf: "AFC" },
  { id: 17, name: "Corea del Sur", en: "South Korea", conf: "AFC" },
  { id: 22, name: "Irán", en: "Iran", conf: "AFC" },
  { id: 20, name: "Australia", en: "Australia", conf: "AFC" },
  { id: 23, name: "Arabia Saudita", en: "Saudi Arabia", conf: "AFC" },
  { id: 1569, name: "Catar", en: "Qatar", conf: "AFC" },
  { id: 1568, name: "Uzbekistán", en: "Uzbekistan", conf: "AFC" },
  { id: 1548, name: "Jordania", en: "Jordan", conf: "AFC" },
  { id: 2384, name: "Estados Unidos", en: "USA", conf: "CONCACAF" },
  { id: 16, name: "México", en: "Mexico", conf: "CONCACAF" },
  { id: 5529, name: "Canadá", en: "Canada", conf: "CONCACAF" },
  { id: 5530, name: "Curazao", en: "Curacao", conf: "CONCACAF" },
  { id: 2386, name: "Haití", en: "Haiti", conf: "CONCACAF" },
  { id: 11, name: "Panamá", en: "Panama", conf: "CONCACAF" },
  { id: 4673, name: "Nueva Zelanda", en: "New Zealand", conf: "OFC" },
  { id: 1567, name: "Irak", en: "Iraq", conf: "Repechaje" },
  { id: 1508, name: "Congo RD", en: "Congo DR", conf: "Repechaje" },
];

export const TEAM_BY_ID = new Map(WORLD_CUP_TEAMS.map((t) => [t.id, t]));
export function getTeamName(id) { return TEAM_BY_ID.get(Number(id))?.name || String(id); }

// Variantes de nombre del repo martj42 -> nuestro campo `en`.
const VARIANTS = { 'United States': 'USA', 'DR Congo': 'Congo DR', 'Curaçao': 'Curacao', 'Türkiye': 'Turkey' };
const enToId = new Map(WORLD_CUP_TEAMS.map((t) => [t.en, t.id]));
export function repoNameToId(name) {
  if (!name) return null;
  const en = VARIANTS[name] || name;
  return enToId.has(en) ? enToId.get(en) : null;
}
