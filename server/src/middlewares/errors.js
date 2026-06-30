import { AppError } from '../utils/http.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Rota nao encontrada.',
    code: 'NOT_FOUND',
    path: req.originalUrl,
    requestId: req.id
  });
}

export function errorHandler(err, req, res, _next) {
  const isKnown = err instanceof AppError || err.status;
  const status = err.status || 500;
  const message = isKnown ? err.message : 'Erro interno.';

  if (!isKnown) {
    console.error({ requestId: req.id, error: err });
  }

  res.status(status).json({
    error: message,
    code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
    details: err.details || null,
    requestId: req.id
  });
}
