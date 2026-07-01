import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query, transaction } from '../db.js';
import { forbidden, unauthorized } from '../utils/http.js';

export function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newOpaqueToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function refreshExpiresAt() {
  return new Date(Date.now() + env.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, nome: user.nome, usuario: user.usuario, perfil: user.perfil, type: 'access' },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, jwtid: crypto.randomUUID() }
  );
}

export function decodeToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('Token nao enviado.'));

  try {
    const payload = decodeToken(token);
    if (payload.type && payload.type !== 'access') throw new Error('invalid token type');

    if (payload.jti) {
      const revoked = await query(
        'SELECT 1 FROM revoked_token WHERE token_jti = $1 AND expires_at > NOW() LIMIT 1',
        [payload.jti]
      );
      if (revoked.rows[0]) return next(unauthorized('Token revogado.'));
    }

    req.user = payload;
    req.accessToken = token;
    next();
  } catch {
    next(unauthorized('Token invalido ou expirado.'));
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.perfil)) return next(forbidden('Perfil sem permissao para esta acao.'));
    next();
  };
}

export async function verifyPassword(inputPassword, storedPassword, userId) {
  if (storedPassword?.startsWith('$2')) {
    return bcrypt.compare(inputPassword, storedPassword);
  }

  const valid = inputPassword === storedPassword;
  if (valid) {
    const hash = await bcrypt.hash(inputPassword, 10);
    await query('UPDATE usuario SET senha = $1 WHERE id = $2', [hash, userId]);
  }
  return valid;
}

export function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function createRefreshToken(user, req, db = { query }) {
  const token = newOpaqueToken();
  const expiresAt = refreshExpiresAt();
  const { rows } = await db.query(
    `INSERT INTO refresh_token (usuario_id, token_hash, user_agent, ip_address, expires_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $1, $1)
     RETURNING id, expires_at`,
    [user.id, hashOpaqueToken(token), req.headers['user-agent'] || null, req.ip || null, expiresAt]
  );
  return { id: rows[0].id, token, expiresAt: rows[0].expires_at };
}

export async function rotateRefreshToken(refreshToken, req) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT rt.id, rt.usuario_id, rt.expires_at, rt.revoked_at,
              u.id AS user_id, u.nome, u.usuario, u.perfil::text AS perfil
         FROM refresh_token rt
         JOIN usuario u ON u.id = rt.usuario_id
        WHERE rt.token_hash = $1 AND u.ativo = true
        LIMIT 1
        FOR UPDATE OF rt`,
      [hashOpaqueToken(refreshToken)]
    );

    const current = rows[0];
    if (!current || current.revoked_at || new Date(current.expires_at).getTime() <= Date.now()) {
      throw unauthorized('Refresh token invalido ou expirado.');
    }

    const user = { id: current.user_id, nome: current.nome, usuario: current.usuario, perfil: current.perfil };
    await client.query('UPDATE refresh_token SET revoked_at = NOW(), updated_at = NOW(), updated_by = $1 WHERE id = $2', [user.id, current.id]);
    const nextRefresh = await createRefreshToken(user, req, client);
    await client.query('UPDATE refresh_token SET replaced_by_id = $1 WHERE id = $2', [nextRefresh.id, current.id]);
    return { user, refreshToken: nextRefresh.token, refreshTokenExpiresAt: nextRefresh.expiresAt };
  });
}

export async function revokeRefreshToken(refreshToken, userId = null) {
  if (!refreshToken) return;
  const params = [hashOpaqueToken(refreshToken)];
  let filter = 'token_hash = $1';
  if (userId) {
    params.push(userId);
    filter += ' AND usuario_id = $2';
  }
  await query(`UPDATE refresh_token SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW() WHERE ${filter}`, params);
}

export async function revokeUserRefreshTokens(userId) {
  await query('UPDATE refresh_token SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW(), updated_by = $1 WHERE usuario_id = $1 AND revoked_at IS NULL', [userId]);
}

export async function blacklistAccessToken(token, reason = 'logout') {
  if (!token) return;
  const payload = jwt.decode(token);
  if (!payload?.jti) return;
  const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 60 * 60 * 1000);
  await query(
    `INSERT INTO revoked_token (token_jti, usuario_id, expires_at, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_jti) DO NOTHING`,
    [payload.jti, payload.id || null, expiresAt, reason]
  );
}

export function createPasswordResetToken() {
  const token = newOpaqueToken();
  return { token, tokenHash: hashOpaqueToken(token) };
}
