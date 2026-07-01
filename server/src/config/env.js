import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

function numberEnv(name, fallback) {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

function listEnv(name, fallback) {
  const value = process.env[name] || fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: numberEnv('API_PORT', 3001),
  databaseUrl: process.env.DATABASE_URL,
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: numberEnv('POSTGRES_PORT', 5432),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'SnoutSync'
  },
  corsOrigins: listEnv('CORS_ORIGIN', 'http://localhost:5173'),
  jwtSecret: process.env.JWT_SECRET || 'snoutsync-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  refreshTokenExpiresDays: numberEnv('REFRESH_TOKEN_EXPIRES_DAYS', 14),
  passwordResetExpiresMinutes: numberEnv('PASSWORD_RESET_EXPIRES_MINUTES', 30),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL || '',
  whatsappWebhookUrl: process.env.WHATSAPP_WEBHOOK_URL || '',
  aiApiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-5.5',
  aiBaseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1'
};

export function assertProductionEnv() {
  if (env.nodeEnv !== 'production') return;

  const problems = [];
  if (!env.databaseUrl) problems.push('DATABASE_URL');
  if (!process.env.JWT_SECRET || env.jwtSecret === 'snoutsync-dev-secret-change-me') problems.push('JWT_SECRET');

  if (problems.length) {
    throw new Error(`Variaveis obrigatorias em producao ausentes ou inseguras: ${problems.join(', ')}`);
  }
}
