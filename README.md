# Predictor de partidos del Mundial

App web para estimar las **probabilidades de resultado** entre dos selecciones del Mundial,
analizando su forma reciente, el historial entre ellas (head-to-head) y sus últimos partidos.
Además podés **elegir qué dato ver**: goles, tarjetas, tiros al arco, tiros totales, córners y faltas.

El modelo principal es un **Dixon-Coles completo**: estima por **máxima verosimilitud (MLE)** una
**fuerza de ataque y una de defensa por selección**, consistentes entre sí, sobre todo el historial
2010+ con decaimiento temporal y regularización. De ahí salen los goles esperados (λ) de cada cruce;
encima se aplican la **corrección Dixon-Coles** de marcadores bajos (`DC_RHO`) y la temperatura de
calibración. Se ajusta con `npm run fit:dc -- --write` (escribe `data/dcParams.json`) y se puede
apagar con `USE_DC_MODEL=0` (vuelve al modelo heurístico de promedios + pesos).

### Validación (backtest)

Todo se valida contra resultados reales (perfiles/ajustes *as-of*, sin fuga de datos) midiendo
**log-loss**, **Brier** y **accuracy** con **train/test split** (entrena hasta 2024, valida 2025+).

- `npm run fit:dc` ajusta el modelo ataque/defensa, busca en grilla sus hiperparámetros
  (decaimiento `xiYears`, shrinkage `l2`, `rho`) y lo **compara contra el heurístico** en test. Pasar
  del heurístico al modelo MLE fue el salto grande: **log-loss 1.053 → 0.996** y **accuracy 48% → 54%**
  (el blend eligió DC puro: el heurístico no aporta nada encima). Resuelve además el problema de
  probabilidades "tibias" (p.ej. Alemania–Curazao pasa a ~91/6/2 en vez de un favorito desdibujado).
- `npm run backtest` mide el modelo en vivo y eligió `DC_RHO` (≈ -0.05) con datos en vez de a ojo.
- `npm run tune` y `npm run tune:elo` calibran el **modelo heurístico** (pesos forma/calidad/rival/H2H)
  y el Elo. Quedan como herramientas del fallback: con `tune` la accuracy del heurístico subió de 45%
  a 49%, pero el modelo MLE lo supera por estructura, no por tuneo.

Para mejorar más allá de esto harían falta **señales nuevas** (xG, alineaciones, lesiones), que no
están en el dataset offline de solo-resultados.

## Calidad por equipo (4 niveles) y fuerza del rival

Cada selección tiene un **rating** y un **nivel/grupo**: **Elite · Alta · Media · Baja**
(definidos en `server/ratings.js`, editables). Eso pesa de dos formas:

- **Fuerza del rival (strength of schedule)**: al promediar los últimos partidos, cada resultado
  se pondera por la calidad del rival. Golearle 4-0 a una potencia **vale más** que golearle 4-0
  a un equipo flojo; recibir goles de un rival débil **penaliza más**. Se controla con
  `OPPONENT_WEIGHT`.
- **Diferencia de nivel**: el rating relativo entre los dos equipos ajusta directamente los goles
  esperados. Se controla con `RATING_WEIGHT`.

En la app se ve el nivel de cada selección (en el desplegable y junto al resultado) y el rating
de cada rival en la lista de partidos recientes.

## Requisitos

- [Node.js](https://nodejs.org/) v20.6 o superior (probado con v24).

## Arranque rápido (modo demo, sin API key)

```bash
npm install
npm run start:noenv
```

Abrí <http://localhost:3000>. Verás el cartel **MODO DEMO**: la app funciona con datos ficticios
para que puedas probarla sin configurar nada.

## Datos reales (API-Football)

1. Registrate gratis en <https://dashboard.api-football.com/register> (plan **Free**: ~100
   peticiones por día; la app cachea las respuestas para no gastar cuota).
2. Copiá tu API key.
3. Copiá `.env.example` a `.env` y pegá la key:

   ```env
   APIFOOTBALL_KEY=tu_api_key_aca
   PORT=3000
   ```

4. Arrancá con la key cargada:

   ```bash
   npm install
   npm start
   ```

5. Abrí <http://localhost:3000>. Ya no aparece el cartel de demo y los datos son reales.

## Datos actuales (2026) — overlay híbrido

El plan **Free de API-Football bloquea el número de temporada 2025/2026**, pero para selecciones
"season" es el **ciclo de la competencia, no el año**: las Eliminatorias del Mundial 2026 están
catalogadas bajo `season=2024`, así que `season=2024` devuelve partidos jugados en **2025 e incluso
hasta marzo de 2026** (p. ej. las Eliminatorias UEFA). Por eso aparecen fechas de 2025/2026 en la
muestra base aunque el número 2025/2026 esté bloqueado. **Pero** el plan Free sí permite una **ventana móvil
de ~3 días** (ayer/hoy/mañana) a través del parámetro `date`, y durante el Mundial eso devuelve
partidos de **2026 con estadísticas completas** (tiros, faltas, córners, tarjetas, xG) y el rival
con su **id real**. La app usa un **overlay pluggable**: API-Football 2024 es la **muestra
multi-partido** y encima se **superpone el último partido de 2026 + el próximo rival**.

Se elige con `DATA_SOURCE` en `.env`:

- `hybrid` *(default)* — **API-Football-live** (la ventana de fechas, con stats completas y rating
  de rival exacto) y, si el equipo no jugó en esos días, **TheSportsDB** de respaldo (key gratis
  `"3"`, siempre tiene el último partido). En la pantalla aparece **"Datos al \<fecha\>"** y
  **"Próximo: vs …"** debajo de cada selección.
- `apifootball-live` — solo la ventana de fechas de API-Football.
- `thesportsdb` — solo **TheSportsDB** (sin registro).
- `rapidapi` — **soccer-data6** (RapidAPI): requiere crear cuenta, suscribirse a un plan y poner
  `RAPIDAPI_KEY`. Queda **listo para activar** pero desactivado mientras la key esté vacía.
- `apifootball` — sin overlay (solo la base de API-Football).

Si la fuente de overlay falla, la app **cae automáticamente** a la base de API-Football, así que
nunca se rompe la predicción.

## Fuente primaria: resultados históricos (martj42/international_results)

Por defecto la app usa, como **fuente principal y offline**, el dataset abierto
[martj42/international_results](https://github.com/martj42/international_results): resultados de
selecciones desde 1872. Bajalo una vez (se filtra a **2010+** y a partidos que involucran a algún
mundialista):

```bash
npm run import:intl
```

Escribe `data/international_results.csv` (~7.400 filas). Con eso, **sin pegarle a ninguna API**, la
app calcula goles esperados, forma reciente, **head-to-head real completo**, último partido (incluye
el **Mundial 2026** en curso) y próximo rival. Para refrescar durante el torneo, volvé a correr el
comando (el repo se actualiza a diario).

Lo único que el repo **no** trae son las **estadísticas detalladas** (tarjetas, tiros al arco,
córners, faltas). Para esas, en la pantalla aparece el botón **“Consultar API”**, que las trae a
demanda desde API-Football (cuesta cuota; si no hay, avisa y la predicción de goles sigue intacta).

Poné `USE_INTL=0` en `.env` para desactivar esta fuente y volver a la API en vivo.

### Ratings por calidad calculados desde los datos (Elo)

El rating/nivel de cada selección se calcula con un **Elo** sobre el historial real de resultados
(no a mano): pondera localía, diferencia de goles e importancia del torneo. Generalo/actualizalo con:

```bash
npm run compute:ratings
```

Escribe `data/ratings.json` (rating de ~290 selecciones). Eso alimenta tanto el nivel mostrado
(Elite/Alta/Media/Baja) como la **ponderación por rival** y el peso de la calidad en los goles
esperados (`RATING_WEIGHT`, subilo para que la calidad pese más). Si el archivo no existe, se usan
los ratings de referencia de `server/ratings.js`.

## Versión web (GitHub Pages)

Hay una versión **100% estática** en `docs/` (el modelo Poisson y la carga de datos corren en el
navegador) publicada en GitHub Pages: <https://fedeqza.github.io/predictor-mundial-2026/>. Cubre
goles, forma, head-to-head y resultados/próximo del Mundial 2026. Las **stats detalladas**
(tarjetas, tiros, córners) no están en la web (requieren la API) — para eso, cloná el repo y corré
la app localmente.

El sitio se **auto-actualiza**: el workflow `.github/workflows/refresh-data.yml` corre cada 6 horas,
re-importa los resultados (`import:intl`), recalcula los ratings (`compute:ratings`), los copia a
`docs/data/` y commitea; Pages redeploya solo. También se puede disparar a mano desde la pestaña
**Actions**.

## Dataset local (CSV) — consumir sin límites de API

Para no depender de API-Football en cada consulta (límite de 10 req/min y 100 req/día, y el riesgo
de que una key quede sin cuota), podés **bajar una vez** los últimos partidos de las 48 selecciones
a un **CSV local** y que la app lo consuma **sin pegarle a la API**.

1. Generá el dataset (necesita una key con cuota):

   ```bash
   npm run build:dataset
   ```

   Baja, por cada selección, sus últimos partidos con goles, forma, rating del rival y
   **estadísticas detalladas** (tarjetas, tiros, córners, faltas), y escribe `data/teams.csv`
   (un equipo por fila) y `data/matches.csv` (un partido por fila). Es **reanudable**: como el plan
   Free son 100 req/día, el script baja en tandas; **corrélo una vez por día** (tras el reset de
   cuota a las 00:00 UTC) hasta que reporte **48/48 listos**. Los equipos ya bajados no se repiten.

2. Activá el consumo en `.env`:

   ```env
   USE_DATASET=1
   ```

3. `npm start`. Ahora los perfiles salen del CSV (0 llamadas a API-Football); el head-to-head se
   deriva de los propios partidos guardados. Para **refrescar** el snapshot durante el Mundial,
   volvé a correr `npm run build:dataset`.

## Cómo se usa

1. Elegí las dos selecciones en los **desplegables** (las 48 del Mundial, agrupadas por
   confederación; usan IDs reales de API-Football, así no hay ambigüedad de nombres).
2. Elegí el dato en el desplegable: **★ Ver todos los datos**, o uno solo (Goles, Tarjetas,
   Tiros al arco, Tiros totales, Córners, Faltas).
3. Tocá **Calcular**. Obtenés:
   - % de Victoria A / Empate / Victoria B.
   - Marcadores más probables y líneas Over/Under de goles.
   - Panel del dato elegido (media esperada por equipo + Over/Under).
   - Forma reciente de cada equipo e historial directo.

## Limitaciones del plan gratuito de API-Football

Al usar la key Free conviene saber:

- **10 peticiones por minuto**: la app las espacia automáticamente (throttle), así que la
  **primera** predicción de un par de equipos puede tardar ~1–1½ minutos. Después queda **cacheada**
  en `cache/` y es instantánea.
- **No admite el parámetro `last`** y los datos llegan **solo hasta la temporada 2024**. Por eso se
  consultan temporadas concretas (`SEASONS=2024,2023`). Para datos de 2025/2026 en tiempo real
  haría falta un plan pago; el modelo y la app no cambian, solo la frescura de los datos.
- **~100 peticiones por día**: la caché en disco evita repetir llamadas y estira la cuota.

El **modo demo** no tiene ninguna de estas limitaciones (datos ficticios instantáneos).

## Calibración (opcional)

En `.env` podés ajustar los pesos del modelo: `HOME_ADVANTAGE`, `FORM_WEIGHT`, `H2H_WEIGHT`,
`RECENT_MATCHES`, `STATS_MATCHES`. Ver comentarios en `.env.example`.

## Estructura

```
server/
  index.js        Servidor Express + rutas /api/*
  config.js       Configuración desde variables de entorno
  apiFootball.js  Cliente de API-Football con caché (memoria + disco)
  currentData.js  Dispatcher del overlay 2026 (elige proveedor segun DATA_SOURCE)
  apiFootballCurrent.js  Datos actuales 2026 via la ventana de fechas de API-Football (stats completas)
  theSportsDb.js  Proveedor de datos actuales de respaldo (TheSportsDB)
  soccerData6.js  Proveedor opcional de datos actuales (soccer-data6 / RapidAPI)
  dataService.js  Resuelve equipos, arma forma/goles/stats/H2H y mezcla el overlay 2026
  model.js        Modelo Poisson + heurística
  worldCupTeams.js Las 48 selecciones con sus IDs de API-Football (editable)
  ratings.js      Calidad (rating) y nivel de cada selección — 4 grupos (editable)
  dataset.js      Lector del dataset local (CSV) para el modo USE_DATASET
  demoData.js     Datos ficticios para el modo demo
scripts/
  buildDataset.mjs  Baja los últimos partidos de los 48 y arma data/*.csv (reanudable)
public/           Frontend web (HTML/CSS/JS)
data/             Dataset local: teams.csv + matches.csv (lo genera build:dataset)
cache/            Respuestas cacheadas (se crea solo)
```

## Aviso

Las probabilidades son estimaciones estadísticas con fines informativos/educativos, no garantías.
