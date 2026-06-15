// Modelo Dixon-Coles de ataque/defensa (versión navegador). NO ajusta nada: solo carga las
// fuerzas att/def precalculadas (data/dcParams.json, generado con npm run fit:dc -- --write) y
// devuelve los goles esperados de un cruce. Espejo de server/dcModel.js + server/dcRatings.js.
//   lambda_A = exp(c + att[A] - def[B])   (cancha neutral: sin ventaja de local, como el Mundial)

let model = null; // { c, h, att, def }

export function setDcModel(m) { model = (m && m.att && m.def) ? m : null; }
export function hasDcData() { return model != null; }

export function dcLambdasForIds(idA, idB) {
  if (!model) return null;
  const aA = model.att[String(idA)], dA = model.def[String(idA)];
  const aB = model.att[String(idB)], dB = model.def[String(idB)];
  if (aA == null || aB == null || dA == null || dB == null) return null;
  const lambdaA = Math.exp(model.c + aA - dB);
  const lambdaB = Math.exp(model.c + aB - dA);
  return { lambdaA, lambdaB };
}
