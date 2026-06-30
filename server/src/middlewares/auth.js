import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../db.js';
import { unauthorized } from '../utils/http.js';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, nome: user.nome, usuario: user.usuario, perfil: user.perfil },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('Token nao enviado.'));

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    next();
  } catch {
    next(unauthorized('Token invalido ou expirado.'));
  }
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
