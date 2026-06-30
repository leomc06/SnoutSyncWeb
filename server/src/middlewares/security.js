import crypto from 'node:crypto';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from '../config/env.js';

export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export function corsMiddleware() {
  return cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origem nao permitida pelo CORS.'));
    },
    credentials: true
  });
}

export const securityHeaders = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
});

export const compressionMiddleware = compression();

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisicoes. Tente novamente em alguns minutos.' }
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos.' }
});
