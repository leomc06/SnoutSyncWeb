import { env } from '../config/env.js';

export async function sendPasswordResetEmail({ to, name, token }) {
  const resetUrl = `${env.frontendUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

  // Adapter mock: substitua por SMTP, SES, Resend ou outro provedor quando houver credenciais.
  console.log({
    event: 'password_reset_email_mock',
    to,
    name,
    resetUrl,
    message: 'Envio real de e-mail ainda nao configurado. Use um adapter em server/src/services/email.js.'
  });
}
