// Adapter de envío: aísla "cómo se manda" el recordatorio para poder sumar otro canal sin tocar el
// disparador (scripts/notifyMatches.mjs). v1: email por SMTP con nodemailer. La imagen va incrustada
// inline (cid, se ve dentro del mail) y además adjunta como PNG. Sin hostear nada, sin plantillas.

import nodemailer from 'nodemailer';

// Lee la config SMTP del entorno. Devuelve null si falta algo esencial (modo "no configurado").
export function smtpFromEnv() {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(process.env.SMTP_PORT || 465);
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const to = (process.env.MAIL_TO || user).trim();
  if (!user || !pass || !to) return null;
  return { host, port, user, pass, to };
}

/**
 * Manda un email con la imagen del partido.
 * @param {object} o
 * @param {object} o.smtp  { host, port, user, pass, to }
 * @param {string} o.subject
 * @param {string} o.html   cuerpo HTML (puede referenciar la imagen con src="cid:matrix")
 * @param {Buffer} o.png    imagen del marcador
 * @param {string} [o.filename]
 */
export async function sendEmail({ smtp, subject, html, png, filename = 'resultados-posibles.png' }) {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465, // 465 = SSL; 587 = STARTTLS
    auth: { user: smtp.user, pass: smtp.pass },
  });

  const info = await transport.sendMail({
    from: smtp.user,
    to: smtp.to,
    subject,
    html,
    attachments: [
      { filename, content: png, cid: 'matrix' }, // inline (referenciada por cid:matrix en el HTML)
      { filename, content: png },                 // y adjunta normal
    ],
  });
  return info.messageId;
}
