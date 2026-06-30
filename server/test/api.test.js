import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = 3999;
const baseUrl = `http://localhost:${port}`;
const serverCwd = fileURLToPath(new URL('..', import.meta.url));

function startServer() {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverCwd,
    env: { ...process.env, API_PORT: String(port) },
    stdio: 'ignore'
  });
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('API nao iniciou a tempo.');
}

test('API autentica e protege rotas principais', async () => {
  const server = startServer();
  try {
    await waitForServer();

    const root = await fetch(`${baseUrl}/`);
    assert.equal(root.status, 200);

    const blocked = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(blocked.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'leonardo', senha: 'TROCAR_SENHA' })
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.ok(session.token);

    const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { Authorization: `Bearer ${session.token}` } });
    assert.equal(dashboard.status, 200);
    const data = await dashboard.json();
    assert.ok(data.metrics);

    const ai = await fetch(`${baseUrl}/api/ai/status`, { headers: { Authorization: `Bearer ${session.token}` } });
    assert.equal(ai.status, 200);
  } finally {
    server.kill('SIGINT');
  }
});
