export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message, details = null) {
  return new AppError(message, 400, 'BAD_REQUEST', details);
}

export function unauthorized(message = 'Nao autenticado.') {
  return new AppError(message, 401, 'UNAUTHORIZED');
}

export function forbidden(message = 'Acesso negado.') {
  return new AppError(message, 403, 'FORBIDDEN');
}

export function notFound(message = 'Recurso nao encontrado.') {
  return new AppError(message, 404, 'NOT_FOUND');
}

export function conflict(message, details = null) {
  return new AppError(message, 409, 'CONFLICT', details);
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function ok(res, data = null, meta = null) {
  res.json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created(res, data = null) {
  res.status(201).json({ success: true, data });
}
