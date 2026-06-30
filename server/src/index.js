import express from 'express';
import cors from 'cors';
import { pool, query, transaction } from './db.js';

const app = express();
const port = Number(process.env.API_PORT || 3001);

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    name: 'SnoutSync API',
    status: 'online',
    message: 'Use as rotas em /api. Exemplo: /api/health',
    routes: ['/api/health', '/api/dashboard', '/api/clientes', '/api/agendamentos', '/api/financeiro', '/api/ai/ask']
  });
});

const statusLabels = {
  AGENDADO: 'Confirmado',
  EM_ANDAMENTO: 'Pendente',
  CONCLUIDO: 'Concluido',
  CANCELADO: 'Cancelado'
};

const statusDb = {
  Confirmado: 'AGENDADO',
  Pendente: 'EM_ANDAMENTO',
  Concluido: 'CONCLUIDO',
  Cancelado: 'CANCELADO',
  AGENDADO: 'AGENDADO',
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  CONCLUIDO: 'CONCLUIDO',
  CANCELADO: 'CANCELADO'
};

const porteLabels = { P: 'Pequeno', M: 'Medio', G: 'Grande' };
const porteDb = { Pequeno: 'P', Medio: 'M', Grande: 'G', P: 'P', M: 'M', G: 'G' };

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function required(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    const error = new Error(`Campo obrigatorio: ${field}`);
    error.status = 400;
    throw error;
  }
  return value;
}

function toMoney(value) {
  return Number(value || 0);
}

function mapCliente(row) {
  return {
    cliente_id: row.cliente_id,
    pet_id: row.pet_id,
    nome: row.cliente_nome,
    telefone: row.telefone || '',
    tipo: row.tipo,
    tipo_label: row.tipo === 'PLANO' ? 'Plano' : 'Avulso',
    pet_nome: row.pet_nome || '',
    especie: row.especie || 'Cachorro',
    raca: row.raca || '',
    peso: row.peso,
    porte: row.porte,
    porte_label: porteLabels[row.porte] || 'Medio'
  };
}

function mapAgendamento(row) {
  return {
    id: row.id,
    pet_id: row.pet_id,
    servico_id: row.servico_id,
    cliente_id: row.cliente_id,
    cliente_nome: row.cliente_nome,
    pet_nome: row.pet_nome,
    servico_nome: row.servico_nome,
    data: row.data,
    hora: String(row.hora).slice(0, 5),
    status: row.status,
    status_label: statusLabels[row.status] || row.status,
    observacoes: row.observacoes || '',
    valor_estimado: toMoney(row.valor_estimado)
  };
}

const valorServicoSql = `
  CASE p.porte
    WHEN 'P' THEN COALESCE(s.preco_pequeno, 0)
    WHEN 'G' THEN COALESCE(s.preco_grande, 0)
    ELSE COALESCE(s.preco_medio, 0)
  END
`;

async function listClientes(search = '') {
  const params = [];
  let where = '';
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    where = `WHERE c.nome ILIKE $1 OR c.telefone ILIKE $1 OR p.nome ILIKE $1 OR p.raca ILIKE $1 OR c.tipo::text ILIKE $1`;
  }

  const { rows } = await query(
    `SELECT c.id AS cliente_id, c.nome AS cliente_nome, c.telefone, c.tipo,
            p.id AS pet_id, p.nome AS pet_nome, p.especie, p.raca, p.peso, p.porte
       FROM cliente c
       LEFT JOIN pet p ON p.cliente_id = c.id
       ${where}
      ORDER BY c.nome, p.nome`,
    params
  );
  return rows.map(mapCliente);
}

async function listAgendamentos({ data, status, search } = {}) {
  const params = [];
  const filters = [];

  if (data) {
    params.push(data);
    filters.push(`a.data = $${params.length}`);
  }
  if (status && status !== 'Todos') {
    params.push(statusDb[status] || status);
    filters.push(`a.status = $${params.length}::status_agendamento`);
  }
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(c.nome ILIKE $${params.length} OR p.nome ILIKE $${params.length} OR s.nome ILIKE $${params.length})`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT a.id, a.pet_id, a.servico_id, p.cliente_id, c.nome AS cliente_nome,
            p.nome AS pet_nome, s.nome AS servico_nome, a.data::text AS data, a.hora::text AS hora,
            a.status::text AS status, a.observacoes, ${valorServicoSql} AS valor_estimado
       FROM agendamento a
       JOIN pet p ON p.id = a.pet_id
       JOIN cliente c ON c.id = p.cliente_id
       JOIN servico s ON s.id = a.servico_id
       ${where}
      ORDER BY a.data DESC, a.hora ASC`,
    params
  );
  return rows.map(mapAgendamento);
}

async function dashboardData() {
  const [metrics, today, revenue] = await Promise.all([
    query(`
      WITH ag AS (
        SELECT a.*, ${valorServicoSql} AS valor_estimado
          FROM agendamento a
          JOIN pet p ON p.id = a.pet_id
          JOIN servico s ON s.id = a.servico_id
      ), plan AS (
        SELECT COALESCE(SUM(preco_mensal), 0) AS receita_planos FROM plano
      )
      SELECT
        (SELECT COUNT(*)::int FROM cliente) AS clientes,
        (SELECT COUNT(*)::int FROM agendamento WHERE data = CURRENT_DATE) AS agendamentos_hoje,
        (SELECT COUNT(*)::int FROM ag WHERE status <> 'CANCELADO') AS servicos_realizados,
        ((SELECT receita_planos FROM plan) + COALESCE((SELECT SUM(valor_estimado) FROM ag WHERE status <> 'CANCELADO'), 0))::numeric AS faturamento_mes,
        (SELECT COUNT(*)::int FROM plano) AS planos_ativos
    `),
    listAgendamentos({ data: new Date().toISOString().slice(0, 10) }),
    query(`
      SELECT EXTRACT(DAY FROM a.data)::int AS dia, SUM(${valorServicoSql})::numeric AS valor
        FROM agendamento a
        JOIN pet p ON p.id = a.pet_id
        JOIN servico s ON s.id = a.servico_id
       WHERE a.status <> 'CANCELADO'
         AND date_trunc('month', a.data::timestamp) = date_trunc('month', CURRENT_DATE::timestamp)
       GROUP BY dia
       ORDER BY dia
    `)
  ]);

  return {
    metrics: metrics.rows[0],
    agendamentos_hoje: today,
    receita_diaria: revenue.rows.map((row) => ({ dia: row.dia, valor: toMoney(row.valor) }))
  };
}

async function financeiroData() {
  const { rows } = await query(`
    WITH ag AS (
      SELECT a.id, a.data, a.status::text AS status, p.nome AS pet_nome, s.nome AS servico_nome, ${valorServicoSql} AS valor_estimado
        FROM agendamento a
        JOIN pet p ON p.id = a.pet_id
        JOIN servico s ON s.id = a.servico_id
    ), plan AS (
      SELECT COALESCE(SUM(preco_mensal), 0) AS receita_planos FROM plano
    )
    SELECT
      ((SELECT receita_planos FROM plan) + COALESCE((SELECT SUM(valor_estimado) FROM ag WHERE status <> 'CANCELADO'), 0))::numeric AS receitas,
      GREATEST(120, ROUND(((SELECT receita_planos FROM plan) + COALESCE((SELECT SUM(valor_estimado) FROM ag WHERE status <> 'CANCELADO'), 0)) * 0.25))::numeric AS despesas,
      COALESCE((SELECT SUM(valor_estimado) FROM ag WHERE status = 'EM_ANDAMENTO'), 0)::numeric AS aberto
  `);

  const receitas = toMoney(rows[0].receitas);
  const despesas = receitas > 0 ? toMoney(rows[0].despesas) : 0;
  const lancamentos = await listAgendamentos({});

  return {
    resumo: {
      receitas,
      despesas,
      lucro: receitas - despesas,
      aberto: toMoney(rows[0].aberto)
    },
    lancamentos: lancamentos.map((item) => ({
      id: item.id,
      data: item.data,
      descricao: `${item.servico_nome} - ${item.pet_nome}`,
      categoria: 'Servicos',
      valor: item.status === 'CANCELADO' ? 0 : item.valor_estimado,
      status: item.status === 'EM_ANDAMENTO' ? 'Aberto' : item.status === 'CANCELADO' ? 'Cancelado' : 'Pago'
    }))
  };
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  const { rows } = await query('SELECT current_database() AS database, current_user AS user, NOW() AS now');
  res.json({ ok: true, postgres: rows[0] });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const usuario = required(req.body.usuario, 'usuario');
  const senha = required(req.body.senha, 'senha');
  const { rows } = await query(
    `SELECT id, nome, usuario, perfil::text AS perfil
       FROM usuario
      WHERE usuario = $1 AND senha = $2 AND ativo = true
      LIMIT 1`,
    [usuario, senha]
  );
  if (!rows[0]) {
    return res.status(401).json({ error: 'Usuario ou senha invalidos.' });
  }
  res.json({ user: rows[0] });
}));

app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  res.json(await dashboardData());
}));

app.get('/api/clientes', asyncRoute(async (req, res) => {
  res.json(await listClientes(req.query.search || ''));
}));

app.post('/api/clientes', asyncRoute(async (req, res) => {
  const body = req.body;
  const result = await transaction(async (client) => {
    const cliente = await client.query(
      `INSERT INTO cliente (nome, telefone, tipo)
       VALUES ($1, $2, $3::tipo_cliente)
       RETURNING id`,
      [required(body.nome, 'nome'), body.telefone || null, body.tipo === 'PLANO' || body.tipo === 'Plano' ? 'PLANO' : 'AVULSO']
    );
    const clienteId = cliente.rows[0].id;
    await client.query(
      `INSERT INTO pet (cliente_id, nome, especie, raca, peso, porte)
       VALUES ($1, $2, $3, $4, $5, $6::porte_pet)`,
      [clienteId, required(body.pet_nome, 'pet_nome'), body.especie || 'Cachorro', body.raca || null, body.peso || null, porteDb[body.porte] || 'M']
    );
    if (body.tipo === 'PLANO' || body.tipo === 'Plano') {
      await client.query(
        `INSERT INTO plano (cliente_id, data_inicio, data_fim, preco_mensal)
         VALUES ($1, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', 200)`,
        [clienteId]
      );
    }
    return clienteId;
  });
  res.status(201).json({ id: result });
}));

app.put('/api/clientes/:clienteId/pets/:petId', asyncRoute(async (req, res) => {
  const clienteId = Number(req.params.clienteId);
  const petId = Number(req.params.petId);
  const body = req.body;
  const tipo = body.tipo === 'PLANO' || body.tipo === 'Plano' ? 'PLANO' : 'AVULSO';

  await transaction(async (client) => {
    await client.query(
      `UPDATE cliente SET nome = $1, telefone = $2, tipo = $3::tipo_cliente WHERE id = $4`,
      [required(body.nome, 'nome'), body.telefone || null, tipo, clienteId]
    );
    await client.query(
      `UPDATE pet SET nome = $1, especie = $2, raca = $3, peso = $4, porte = $5::porte_pet WHERE id = $6 AND cliente_id = $7`,
      [required(body.pet_nome, 'pet_nome'), body.especie || 'Cachorro', body.raca || null, body.peso || null, porteDb[body.porte] || 'M', petId, clienteId]
    );
    const plano = await client.query('SELECT id FROM plano WHERE cliente_id = $1 LIMIT 1', [clienteId]);
    if (tipo === 'PLANO' && !plano.rows[0]) {
      await client.query(
        `INSERT INTO plano (cliente_id, data_inicio, data_fim, preco_mensal)
         VALUES ($1, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', 200)`,
        [clienteId]
      );
    }
    if (tipo === 'AVULSO' && plano.rows[0]) {
      await client.query('DELETE FROM plano WHERE cliente_id = $1', [clienteId]);
    }
  });
  res.json({ ok: true });
}));

app.delete('/api/clientes/:clienteId', asyncRoute(async (req, res) => {
  const clienteId = Number(req.params.clienteId);
  await transaction(async (client) => {
    await client.query(`DELETE FROM atendimento WHERE agendamento_id IN (SELECT a.id FROM agendamento a JOIN pet p ON p.id = a.pet_id WHERE p.cliente_id = $1)`, [clienteId]);
    await client.query(`DELETE FROM agendamento WHERE pet_id IN (SELECT id FROM pet WHERE cliente_id = $1)`, [clienteId]);
    await client.query('DELETE FROM plano WHERE cliente_id = $1', [clienteId]);
    await client.query('DELETE FROM pet WHERE cliente_id = $1', [clienteId]);
    await client.query('DELETE FROM cliente WHERE id = $1', [clienteId]);
  });
  res.json({ ok: true });
}));

app.get('/api/pets', asyncRoute(async (_req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.nome, p.porte::text AS porte, c.id AS cliente_id, c.nome AS cliente_nome
       FROM pet p JOIN cliente c ON c.id = p.cliente_id
      ORDER BY c.nome, p.nome`
  );
  res.json(rows);
}));

app.get('/api/servicos', asyncRoute(async (_req, res) => {
  const { rows } = await query('SELECT * FROM servico ORDER BY nome');
  res.json(rows);
}));

app.get('/api/agendamentos', asyncRoute(async (req, res) => {
  res.json(await listAgendamentos(req.query));
}));

app.post('/api/agendamentos', asyncRoute(async (req, res) => {
  const body = req.body;
  const { rows } = await query(
    `INSERT INTO agendamento (pet_id, servico_id, data, hora, status, observacoes)
     VALUES ($1, $2, $3, $4, $5::status_agendamento, $6)
     RETURNING id`,
    [required(body.pet_id, 'pet_id'), required(body.servico_id, 'servico_id'), required(body.data, 'data'), required(body.hora, 'hora'), statusDb[body.status] || 'AGENDADO', body.observacoes || null]
  );
  res.status(201).json({ id: rows[0].id });
}));

app.put('/api/agendamentos/:id', asyncRoute(async (req, res) => {
  const body = req.body;
  await query(
    `UPDATE agendamento
        SET pet_id = $1, servico_id = $2, data = $3, hora = $4, status = $5::status_agendamento, observacoes = $6
      WHERE id = $7`,
    [required(body.pet_id, 'pet_id'), required(body.servico_id, 'servico_id'), required(body.data, 'data'), required(body.hora, 'hora'), statusDb[body.status] || 'AGENDADO', body.observacoes || null, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/agendamentos/:id', asyncRoute(async (req, res) => {
  await transaction(async (client) => {
    await client.query('DELETE FROM atendimento WHERE agendamento_id = $1', [req.params.id]);
    await client.query('DELETE FROM agendamento WHERE id = $1', [req.params.id]);
  });
  res.json({ ok: true });
}));

app.get('/api/financeiro', asyncRoute(async (_req, res) => {
  res.json(await financeiroData());
}));

app.post('/api/ai/ask', asyncRoute(async (req, res) => {
  const question = String(req.body.question || '').toLowerCase();
  const dashboard = await dashboardData();
  const financeiro = await financeiroData();
  let answer = `Resumo atual: ${dashboard.metrics.clientes} clientes, ${dashboard.metrics.agendamentos_hoje} agendamentos hoje e faturamento estimado de R$ ${toMoney(dashboard.metrics.faturamento_mes).toFixed(2)}.`;

  if (question.includes('cliente')) {
    const clientes = await listClientes('');
    answer = `Existem ${clientes.length} cadastro(s) de cliente/pet. Clientes de plano: ${clientes.filter((c) => c.tipo === 'PLANO').length}.`;
  } else if (question.includes('agenda') || question.includes('hoje')) {
    answer = dashboard.agendamentos_hoje.length
      ? `Hoje ha ${dashboard.agendamentos_hoje.length} agendamento(s): ${dashboard.agendamentos_hoje.map((a) => `${a.hora} ${a.pet_nome} (${a.servico_nome})`).join('; ')}.`
      : 'Nao ha agendamentos para hoje.';
  } else if (question.includes('fatur') || question.includes('receita') || question.includes('financeiro')) {
    answer = `Financeiro estimado: R$ ${financeiro.resumo.receitas.toFixed(2)} em receitas, R$ ${financeiro.resumo.despesas.toFixed(2)} em despesas, lucro de R$ ${financeiro.resumo.lucro.toFixed(2)} e R$ ${financeiro.resumo.aberto.toFixed(2)} em aberto.`;
  } else if (question.includes('melhor') || question.includes('sugest')) {
    answer = 'Sugestoes: confirmar agendamentos pendentes, reduzir janelas vazias na agenda, incentivar clientes avulsos a migrarem para plano e registrar atendimento/pagamento ao concluir cada servico.';
  }

  res.json({ answer, source: 'Consulta analitica no PostgreSQL conectado' });
}));

app.use((req, res) => {
  res.status(404).json({ error: 'Rota nao encontrada.' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno.' });
});

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`SnoutSync API rodando em http://localhost:${port}`);
});
