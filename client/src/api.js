const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export async function api(path, options = {}) {
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

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('snoutsync:user');
      localStorage.removeItem('snoutsync:token');
    }
    throw new Error(data.error || 'Erro ao comunicar com a API.');
  }
  return data;
}

export { API_URL };
