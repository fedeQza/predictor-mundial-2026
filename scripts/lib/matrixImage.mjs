// Genera un PNG de la "matriz de marcadores posibles" (heatmap 0-4 x 0-4) a partir del scoreMatrix que
// devuelve el modelo (server/model.js -> goals.scoreMatrix). Replica el look de la web (renderScoreMatrix
// en public/app.js + .score-matrix en public/styles.css), pero del lado servidor: arma un SVG y lo
// rasteriza con sharp (sin navegador). Cálculo puro salvo el render final.

import sharp from 'sharp';

// Mismos colores que las variables CSS de la web: --a / --b / --draw, panel y textos.
const COL = {
  a: [74, 158, 255],     // --a (gana A / filas)
  b: [255, 107, 107],    // --b (gana B / columnas)
  draw: [201, 162, 39],  // --draw (empates / diagonal)
  bg: '#0f1420',
  panel: '#1a2030',
  panel2: '#232b3e',
  text: '#e8edf5',
  muted: '#93a0b5',
};

const xmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
));

// Layout (px).
const PAD = 26;
const TITLE_H = 78;
const HCOL_W = 66;   // ancho de la columna de encabezado (goles de A)
const HROW_H = 46;   // alto de la fila de encabezado (goles de B)
const CELL_W = 98;
const CELL_H = 66;
const LEGEND_H = 40;

/**
 * @param {object} o
 * @param {number[][]} o.scoreMatrix  5x5, scoreMatrix[a][b] = % del marcador exacto a-b
 * @param {string} o.nameA  equipo de las filas
 * @param {string} o.nameB  equipo de las columnas
 * @param {string} [o.subtitle]  p.ej. la hora del partido
 * @param {number} [o.lambdaA] goles esperados A (para el pie)
 * @param {number} [o.lambdaB] goles esperados B
 * @returns {Promise<Buffer>} PNG
 */
export async function matrixImagePng({ scoreMatrix, nameA, nameB, subtitle = '', lambdaA, lambdaB }) {
  const n = scoreMatrix.length;
  const gridW = HCOL_W + n * CELL_W;
  const gridH = HROW_H + n * CELL_H;
  const W = PAD * 2 + gridW;
  const H = PAD + TITLE_H + gridH + LEGEND_H + PAD;

  // Máximo y celda más probable (para la intensidad y el resaltado).
  let max = 0, topA = 0, topB = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (scoreMatrix[a][b] > max) { max = scoreMatrix[a][b]; topA = a; topB = b; }
  }

  const gridX = PAD;
  const gridY = PAD + TITLE_H;

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${COL.bg}"/>`);
  parts.push(`<rect x="${PAD - 10}" y="${PAD - 10}" width="${W - 2 * (PAD - 10)}" height="${H - 2 * (PAD - 10)}" rx="14" fill="${COL.panel}"/>`);

  // Título + subtítulo.
  parts.push(`<text x="${W / 2}" y="${PAD + 28}" text-anchor="middle" font-family="Arial, Segoe UI, sans-serif" font-size="26" font-weight="700" fill="${COL.text}">${xmlEscape(nameA)} <tspan fill="${COL.muted}">vs</tspan> ${xmlEscape(nameB)}</text>`);
  parts.push(`<text x="${W / 2}" y="${PAD + 54}" text-anchor="middle" font-family="Arial, Segoe UI, sans-serif" font-size="15" fill="${COL.muted}">Resultados posibles${subtitle ? ' · ' + xmlEscape(subtitle) : ''}</text>`);

  const rgb = (c, op) => `fill="rgb(${c[0]},${c[1]},${c[2]})" fill-opacity="${op.toFixed(3)}"`;

  // Encabezados de columna (goles de B).
  for (let b = 0; b < n; b++) {
    const cx = gridX + HCOL_W + b * CELL_W + CELL_W / 2;
    const cy = gridY + HROW_H / 2;
    parts.push(`<rect x="${gridX + HCOL_W + b * CELL_W + 2}" y="${gridY + 2}" width="${CELL_W - 4}" height="${HROW_H - 4}" rx="6" fill="${COL.panel2}"/>`);
    parts.push(`<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="rgb(${COL.b.join(',')})">${b}</text>`);
  }
  // Encabezados de fila (goles de A).
  for (let a = 0; a < n; a++) {
    const cx = gridX + HCOL_W / 2;
    const cy = gridY + HROW_H + a * CELL_H + CELL_H / 2;
    parts.push(`<rect x="${gridX + 2}" y="${gridY + HROW_H + a * CELL_H + 2}" width="${HCOL_W - 4}" height="${CELL_H - 4}" rx="6" fill="${COL.panel2}"/>`);
    parts.push(`<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="rgb(${COL.a.join(',')})">${a}</text>`);
  }

  // Celdas.
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const v = scoreMatrix[a][b];
      const x = gridX + HCOL_W + b * CELL_W;
      const y = gridY + HROW_H + a * CELL_H;
      const c = a > b ? COL.a : a < b ? COL.b : COL.draw;
      const op = max > 0 ? 0.06 + 0.84 * (v / max) : 0;
      parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${CELL_W - 4}" height="${CELL_H - 4}" rx="6" ${rgb(c, op)}/>`);
      if (a === topA && b === topB) {
        parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${CELL_W - 4}" height="${CELL_H - 4}" rx="6" fill="none" stroke="${COL.text}" stroke-width="3"/>`);
      }
      const label = v > 0 ? v.toFixed(1) + '%' : '·';
      const weight = (a === topA && b === topB) ? '800' : '500';
      parts.push(`<text x="${x + CELL_W / 2}" y="${y + CELL_H / 2 + 6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="${weight}" fill="${COL.text}">${label}</text>`);
    }
  }

  // Pie / leyenda.
  const legY = gridY + gridH + 26;
  const xgTxt = (lambdaA != null && lambdaB != null) ? `  ·  goles esperados ${lambdaA}-${lambdaB}` : '';
  parts.push(`<text x="${W / 2}" y="${legY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="${COL.muted}">Filas: <tspan fill="rgb(${COL.a.join(',')})" font-weight="700">${xmlEscape(nameA)}</tspan>  ·  Columnas: <tspan fill="rgb(${COL.b.join(',')})" font-weight="700">${xmlEscape(nameB)}</tspan>${xgTxt}</text>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
