import { badRequest } from './http.js';

export function required(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw badRequest(`Campo obrigatorio: ${field}`, { field });
  }
  return value;
}

export function validateDate(value, field = 'data') {
  required(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw badRequest(`Campo ${field} deve estar no formato yyyy-mm-dd.`, { field });
  }
  return value;
}

export function validateTime(value, field = 'hora') {
  required(value, field);
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(value))) {
    throw badRequest(`Campo ${field} deve estar no formato hh:mm.`, { field });
  }
  return String(value).slice(0, 5);
}

export function validateEnum(value, allowed, field) {
  required(value, field);
  if (!allowed.includes(value)) {
    throw badRequest(`Campo ${field} invalido. Use: ${allowed.join(', ')}.`, { field, allowed });
  }
  return value;
}

export function validateMoney(value, field) {
  const number = Number(required(value, field));
  if (!Number.isFinite(number) || number < 0) {
    throw badRequest(`Campo ${field} deve ser um numero positivo.`, { field });
  }
  return number;
}

export function validatePositiveInt(value, field) {
  const number = Number(required(value, field));
  if (!Number.isInteger(number) || number <= 0) {
    throw badRequest(`Campo ${field} deve ser um inteiro positivo.`, { field });
  }
  return number;
}
