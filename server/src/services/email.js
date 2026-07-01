import { env } from '../config/env.js';

async function postWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Webhook falhou: ${response.status} ${await response.text()}`);
  }
}

export async function sendEmail({ to, subject, text, metadata = {} }) {
  if (env.emailWebhookUrl) {
    await postWebhook(env.emailWebhookUrl, { to, subject, text, metadata });
    return { sent: true, provider: 'webhook' };
  }

  console.log({
    event: 'email_mock',
    to,
    subject,
    text,
    metadata,
    message: 'Envio real de e-mail nao configurado. Defina EMAIL_WEBHOOK_URL.'
  });
  return { sent: false, provider: 'mock' };
}

export async function sendWhatsApp({ to, text, metadata = {} }) {
  if (env.whatsappWebhookUrl) {
    await postWebhook(env.whatsappWebhookUrl, { to, text, metadata });
    return { sent: true, provider: 'webhook' };
  }

  console.log({
    event: 'whatsapp_mock',
    to,
    text,
    metadata,
    message: 'Envio real de WhatsApp nao configurado. Defina WHATSAPP_WEBHOOK_URL.'
  });
  return { sent: false, provider: 'mock' };
}

export async function sendPasswordResetEmail({ to, name, token }) {
  const resetUrl = `${env.frontendUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'Recuperacao de senha - SnoutSync',
    text: `Ola ${name}, use este link para redefinir sua senha: ${resetUrl}`,
    metadata: { type: 'password_reset', resetUrl }
  });
}
