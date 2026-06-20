// Recordatorio por email ~2h antes de cada partido cargado en data/fixtures.json: arma la predicción
// (mismo pipeline offline que scripts/wcReport.mjs), genera la imagen de "resultados posibles" y la
// manda por mail. Corre via GitHub Actions cada 15 min (.github/workflows/notify-matches.yml); un ledger
// (data/notified.json) evita reenviar. Uso local:  npm run notify   (o  --dry-run  para no enviar).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../server/config.js';
import { repoNameToId, getIntlProfile, getIntlH2H } from '../server/intlResults.js';
import { predict } from '../server/model.js';
import { matrixImagePng } from './lib/matrixImage.mjs';
import { sendEmail, smtpFromEnv } from './lib/notifier.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'data', 'fixtures.json');
const LEDGER = path.join(ROOT, 'data', 'notified.json');

const DRY_RUN = process.argv.includes('--dry-run');
// --force: manda el próximo partido como PRUEBA, ignorando la ventana y SIN tocar el ledger (el
// recordatorio real igual saldrá después). Sirve para verificar el envío/credenciales a demanda.
const FORCE = process.argv.includes('--force');
// Ventana de disparo (minutos antes del kickoff). Ancha para tolerar atrasos/saltos del cron de Actions;
// el ledger evita duplicados aunque varias corridas caigan dentro.
const WIN_MIN = 90;
const WIN_MAX = 150;

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

const fixtureKey = (f) => `${f.kickoff}|${f.home}|${f.away}`;

function kickoffLabel(iso) {
  const d = new Date(iso);
  const ar = d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${ar} (hora ARG)`;
}

async function buildEmail(f) {
  const idA = repoNameToId(f.home);
  const idB = repoNameToId(f.away);
  if (idA == null || idB == null) {
    return { skip: `no se pudo resolver ${idA == null ? f.home : f.away} con repoNameToId` };
  }
  const pa = getIntlProfile(idA, config.opponentWeight);
  const pb = getIntlProfile(idB, config.opponentWeight);
  if (!pa || !pb) return { skip: `sin perfil para ${!pa ? f.home : f.away}` };
  const h = getIntlH2H(pa, pb);

  const res = predict(pa, pb, h, 'goals');
  const g = res.goals;
  const o = g.outcome;
  const when = kickoffLabel(f.kickoff);

  const png = await matrixImagePng({
    scoreMatrix: g.scoreMatrix,
    nameA: f.home,
    nameB: f.away,
    subtitle: when,
    lambdaA: g.lambdaA,
    lambdaB: g.lambdaB,
  });

  const top = (g.topScores || []).slice(0, 3).map((s) => `${s.score} (${s.prob}%)`).join(' · ');
  const subject = `⚽ En ~2h: ${f.home} vs ${f.away}`;
  const html = `
    <div style="font-family:Arial,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#e8edf5;background:#0f1420;padding:20px;border-radius:12px">
      <h2 style="margin:0 0 4px">${f.home} <span style="color:#93a0b5">vs</span> ${f.away}</h2>
      <p style="margin:0 0 14px;color:#93a0b5">Arranca ${when} · faltan ~2 horas</p>
      <img src="cid:matrix" alt="Resultados posibles" style="width:100%;border-radius:10px"/>
      <table style="width:100%;margin-top:14px;border-collapse:collapse;font-size:15px">
        <tr>
          <td style="padding:6px 0;color:#4a9eff;font-weight:700">Gana ${f.home}: ${o.winA}%</td>
          <td style="padding:6px 0;color:#c9a227;font-weight:700;text-align:center">Empate: ${o.draw}%</td>
          <td style="padding:6px 0;color:#ff6b6b;font-weight:700;text-align:right">Gana ${f.away}: ${o.winB}%</td>
        </tr>
      </table>
      <p style="margin:8px 0 0;color:#93a0b5;font-size:14px">Marcadores más probables: ${top || 's/d'}</p>
      <p style="margin:4px 0 0;color:#93a0b5;font-size:14px">Goles esperados: ${g.lambdaA} - ${g.lambdaB}</p>
      <p style="margin:16px 0 0;color:#5a6678;font-size:12px">Predictor Mundial 2026 · modelo offline (Dixon-Coles + cuotas)</p>
    </div>`;

  return { png, subject, html };
}

async function main() {
  const fixturesDoc = readJson(FIXTURES, { fixtures: [] });
  const fixtures = fixturesDoc.fixtures || [];
  const ledger = readJson(LEDGER, { sent: {} });
  if (!ledger.sent) ledger.sent = {};

  const now = Date.now();
  let due;
  if (FORCE) {
    // Prueba: el próximo partido futuro, ignorando ventana y ledger.
    due = fixtures
      .filter((f) => new Date(f.kickoff).getTime() > now)
      .sort((a, b) => (a.kickoff < b.kickoff ? -1 : 1))
      .slice(0, 1);
    console.log('[notify] --force: mando el próximo partido como PRUEBA (sin tocar el ledger).');
  } else {
    due = fixtures.filter((f) => {
      if (ledger.sent[fixtureKey(f)]) return false;
      const t = new Date(f.kickoff).getTime();
      if (!Number.isFinite(t)) return false;
      const minsToKickoff = (t - now) / 60000;
      return minsToKickoff >= WIN_MIN && minsToKickoff <= WIN_MAX;
    });
  }

  console.log(`[notify] ${new Date().toISOString()} · fixtures=${fixtures.length} · due=${due.length} · dryRun=${DRY_RUN} · force=${FORCE}`);
  if (due.length === 0) { console.log('[notify] nada para mandar.'); return; }

  const smtp = smtpFromEnv();
  if (!DRY_RUN && !smtp) {
    console.error('[notify] FALTAN credenciales SMTP (SMTP_USER/SMTP_PASS/MAIL_TO). Abortando envío.');
    process.exitCode = 1;
    return;
  }

  let sent = 0;
  for (const f of due) {
    const built = await buildEmail(f);
    if (built.skip) { console.warn(`[notify] salteo ${f.home} vs ${f.away}: ${built.skip}`); continue; }

    if (DRY_RUN) {
      const out = path.join(ROOT, `notify-preview-${f.home}-${f.away}`.replace(/[^\w-]/g, '_') + '.png');
      fs.writeFileSync(out, built.png);
      console.log(`[notify][dry-run] ${f.home} vs ${f.away} → imagen escrita en ${out} (no se envió)`);
    } else {
      const subject = FORCE ? `[PRUEBA] ${built.subject}` : built.subject;
      const id = await sendEmail({ smtp, subject, html: built.html, png: built.png });
      console.log(`[notify] enviado ${f.home} vs ${f.away} → ${smtp.to} (messageId ${id})`);
      if (!FORCE) ledger.sent[fixtureKey(f)] = new Date().toISOString(); // la prueba no marca el ledger
    }
    sent++;
  }

  if (!DRY_RUN && !FORCE && sent > 0) {
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
    console.log(`[notify] ledger actualizado (${Object.keys(ledger.sent).length} enviados en total).`);
  }
}

main().catch((err) => { console.error('[notify] error:', err); process.exitCode = 1; });
