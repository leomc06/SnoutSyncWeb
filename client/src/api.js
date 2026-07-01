const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export function saveSession(session) {
  localStorage.setItem('snoutsync:user', JSON.stringify(session.user));
  localStorage.setItem('snoutsync:token', session.token);
  if (session.refreshToken) localStorage.setItem('snoutsync:refreshToken', session.refreshToken);
}

export function clearSession() {
  localStorage.removeItem('snoutsync:user');
  localStorage.removeItem('snoutsync:token');
  localStorage.removeItem('snoutsync:refreshToken');
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('snoutsync:refreshToken');
  if (!refreshToken) throw new Error('Sessao expirada.');
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Sessao expirada.');
  const session = payload?.success ? payload.data : payload;
  saveSession(session);
  return session.token;
}

export async function api(path, options = {}, retry = true) {
  const token = localStorage.getItem('snoutsync:token');
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && retry && !path.startsWith('/auth/')) {
      try {
        await refreshAccessToken();
        return api(path, options, false);
      } catch {
        clearSession();
      }
    } else if (response.status === 401) {
      clearSession();
    }
    const error = new Error(payload.error?.message || payload.error || 'Erro ao comunicar com a API.');
    error.details = payload.details || null;
    throw error;
  }
  return payload?.success ? payload.data : payload;
}

export async function uploadApi(path, formData) {
  const token = localStorage.getItem('snoutsync:token');
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Erro ao enviar arquivo.');
    error.details = payload.details || null;
    throw error;
  }
  return payload?.success ? payload.data : payload;
}

export { API_URL };
