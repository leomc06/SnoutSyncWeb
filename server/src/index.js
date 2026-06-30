import express from 'express';
import PDFDocument from 'pdfkit';
import { pool, query, transaction } from './db.js';
import { env, assertProductionEnv } from './config/env.js';
import { ensureSchema } from './database/ensureSchema.js';
import { requireAuth, signToken, verifyPassword } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/errors.js';
import { apiRateLimit, authRateLimit, compressionMiddleware, corsMiddleware, requestId, securityHeaders } from './middlewares/security.js';
import { asyncRoute, badRequest, conflict, created, notFound, ok, unauthorized } from './utils/http.js';
import { required, validateDate, validateEnum, validateMoney, validatePositiveInt, validateTime } from './utils/validators.js';

const app = express();
assertProductionEnv();

app.set('trust proxy', 1);
app.use(requestId);
app.use(securityHeaders);
app.use(compressionMiddleware);
app.use(corsMiddleware());
app.use(apiRateLimit);
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    name: 'SnoutSync API',
    status: 'online',
    message: 'Use as rotas em /api. Exemplo: /api/health',
    routes: ['/api/health', '/api/dashboard', '/api/clientes', '/api/agendamentos', '/api/servicos', '/api/financeiro', '/api/relatorios/financeiro.csv', '/api/relatorios/financeiro.pdf', '/api/ai/ask']
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
    valor_estimado: toMoney(row.valor_estimado),
    atendimento_id: row.atendimento_id || null,
    valor_cobrado: row.valor_cobrado === null ? null : toMoney(row.valor_cobrado),
    forma_pagamento: row.forma_pagamento || '',
    data_hora_conclusao: row.data_hora_conclusao || null
  };
}

const valorServicoSql = `
  CASE p.porte
    WHEN 'P' THEN COALESCE(s.preco_pequeno, 0)
    WHEN 'G' THEN COALESCE(s.preco_grande, 0)
    ELSE COALESCE(s.preco_medio, 0)
  END
`;

const duracaoServicoSql = `
  CASE p.porte
    WHEN 'P' THEN COALESCE(s.duracao_pequeno, 60)
    WHEN 'G' THEN COALESCE(s.duracao_grande, 60)
    ELSE COALESCE(s.duracao_medio, 60)
  END
`;

async function assertNoScheduleConflict({ petId, servicoId, data, hora, excludeId = null }) {
  const params = [petId, servicoId, data, hora, excludeId];
  const { rows } = await query(
    `WITH novo AS (
       SELECT ($3::date + $4::time) AS inicio,
              ($3::date + $4::time) + (${duracaoServicoSql} * INTERVAL '1 minute') AS fim
         FROM pet p
         JOIN servico s ON s.id = $2
        WHERE p.id = $1
     ), existentes AS (
       SELECT a.id, p.nome AS pet_nome, s.nome AS servico_nome,
              (a.data + a.hora) AS inicio,
              (a.data + a.hora) + (${duracaoServicoSql} * INTERVAL '1 minute') AS fim
         FROM agendamento a
         JOIN pet p ON p.id = a.pet_id
         JOIN servico s ON s.id = a.servico_id
        WHERE a.data = $3::date
          AND a.status <> 'CANCELADO'
          AND ($5::int IS NULL OR a.id <> $5::int)
     )
     SELECT e.*
       FROM existentes e
       CROSS JOIN novo n
      WHERE e.inicio < n.fim AND e.fim > n.inicio
      LIMIT 1`,
    params
  );

  if (rows[0]) {
    throw conflict(`Conflito de horario com ${rows[0].pet_nome} (${rows[0].servico_nome}).`, rows[0]);
  }
}

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
            a.status::text AS status, a.observacoes, ${valorServicoSql} AS valor_estimado,
            at.id AS atendimento_id, at.valor_cobrado, at.forma_pagamento, at.data_hora_conclusao::text AS data_hora_conclusao
       FROM agendamento a
       JOIN pet p ON p.id = a.pet_id
       JOIN cliente c ON c.id = p.cliente_id
       JOIN servico s ON s.id = a.servico_id
       LEFT JOIN atendimento at ON at.agendamento_id = a.id
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

async function safeAiQueries(question) {
  const text = question.toLowerCase();
  const results = {};

  if (text.includes('cliente') || text.includes('tutor')) {
    results.clientes = (await query(
      `SELECT c.id, c.nome, c.telefone, c.tipo::text AS tipo, COUNT(p.id)::int AS pets
         FROM cliente c
         LEFT JOIN pet p ON p.cliente_id = c.id
        GROUP BY c.id
        ORDER BY c.nome
        LIMIT 50`
    )).rows;
  }

  if (text.includes('pet') || text.includes('animal') || text.includes('historico')) {
    results.pets = (await query(
      `SELECT p.id, p.nome, p.especie, p.raca, p.porte::text AS porte, c.nome AS cliente
         FROM pet p
         JOIN cliente c ON c.id = p.cliente_id
        ORDER BY p.nome
        LIMIT 50`
    )).rows;
  }

  if (text.includes('agenda') || text.includes('agendamento') || text.includes('horario')) {
    results.agendamentos = (await query(
      `SELECT a.id, a.data::text AS data, a.hora::text AS hora, a.status::text AS status, p.nome AS pet, c.nome AS cliente, s.nome AS servico
         FROM agendamento a
         JOIN pet p ON p.id = a.pet_id
         JOIN cliente c ON c.id = p.cliente_id
         JOIN servico s ON s.id = a.servico_id
        ORDER BY a.data DESC, a.hora DESC
        LIMIT 50`
    )).rows;
  }

  if (text.includes('servico') || text.includes('preco') || text.includes('duracao')) {
    results.servicos = (await query('SELECT id, nome, descricao, preco_pequeno, preco_medio, preco_grande, duracao_pequeno, duracao_medio, duracao_grande FROM servico ORDER BY nome LIMIT 50')).rows;
  }

  if (text.includes('financeiro') || text.includes('fatur') || text.includes('receita') || text.includes('lucro') || text.includes('pagamento')) {
    results.atendimentos = (await query(
      `SELECT at.id, at.valor_cobrado, at.forma_pagamento, at.data_hora_conclusao::text AS conclusao, p.nome AS pet, s.nome AS servico
         FROM atendimento at
         JOIN agendamento a ON a.id = at.agendamento_id
         JOIN pet p ON p.id = a.pet_id
         JOIN servico s ON s.id = a.servico_id
        ORDER BY at.data_hora_conclusao DESC
        LIMIT 50`
    )).rows;
  }

  return results;
}

async function aiContext(question = '') {
  const [dashboard, financeiro, clientes, agendamentos, servicos] = await Promise.all([
    dashboardData(),
    financeiroData(),
    listClientes(''),
    listAgendamentos({}),
    query('SELECT id, nome, descricao, preco_pequeno, preco_medio, preco_grande, duracao_pequeno, duracao_medio, duracao_grande FROM servico ORDER BY nome')
  ]);

  return {
    gerado_em: new Date().toISOString(),
    dashboard: dashboard.metrics,
    agendamentos_hoje: dashboard.agendamentos_hoje,
    financeiro: financeiro.resumo,
    clientes: clientes.slice(0, 20),
    ultimos_agendamentos: agendamentos.slice(0, 20),
    servicos: servicos.rows,
    consultas_seguras: await safeAiQueries(question)
  };
}

function localAiFallback(question, context) {
  const text = question.toLowerCase();
  const metrics = context.dashboard;
  const financeiro = context.financeiro;

  if (text.includes('cliente')) {
    const planos = context.clientes.filter((cliente) => cliente.tipo === 'PLANO').length;
    return `Existem ${context.clientes.length} cadastro(s) de cliente/pet no contexto carregado. ${planos} estao em plano e ${context.clientes.length - planos} estao como avulso.`;
  }

  if (text.includes('agenda') || text.includes('hoje')) {
    return context.agendamentos_hoje.length
      ? `Hoje ha ${context.agendamentos_hoje.length} agendamento(s): ${context.agendamentos_hoje.map((a) => `${a.hora} ${a.pet_nome} (${a.servico_nome})`).join('; ')}.`
      : 'Nao ha agendamentos para hoje no banco conectado.';
  }

  if (text.includes('fatur') || text.includes('receita') || text.includes('financeiro') || text.includes('lucro')) {
    return `Financeiro estimado: R$ ${financeiro.receitas.toFixed(2)} em receitas, R$ ${financeiro.despesas.toFixed(2)} em despesas, lucro de R$ ${financeiro.lucro.toFixed(2)} e R$ ${financeiro.aberto.toFixed(2)} em aberto.`;
  }

  if (text.includes('servico') || text.includes('serviço') || text.includes('preco') || text.includes('preço')) {
    return context.servicos.length
      ? `Servicos cadastrados: ${context.servicos.map((s) => `${s.nome} (P R$ ${toMoney(s.preco_pequeno).toFixed(2)}, M R$ ${toMoney(s.preco_medio).toFixed(2)}, G R$ ${toMoney(s.preco_grande).toFixed(2)})`).join('; ')}.`
      : 'Nao ha servicos cadastrados no banco conectado.';
  }

  if (text.includes('pet') || text.includes('animal')) {
    const pets = context.consultas_seguras.pets || context.clientes.map((cliente) => ({ nome: cliente.pet_nome, cliente: cliente.nome, raca: cliente.raca }));
    return pets.length
      ? `Pets no contexto: ${pets.map((pet) => `${pet.nome} (${pet.raca || pet.especie || 'sem detalhes'}) - tutor ${pet.cliente}`).join('; ')}.`
      : 'Nao encontrei pets no banco conectado.';
  }

  if (text.includes('relatorio') || text.includes('relatório')) {
    return 'Os relatorios financeiros estao disponiveis na tela Financeiro nos botoes CSV e PDF. A API tambem oferece /api/relatorios/financeiro.csv e /api/relatorios/financeiro.pdf.';
  }

  if (text.includes('melhor') || text.includes('sugest')) {
    return 'Sugestoes: usar senhas com hash, criar calendario visual, registrar pagamentos reais, acompanhar historico de cada pet, enviar lembretes por WhatsApp e transformar clientes avulsos recorrentes em planos.';
  }

  return `Ainda estou em modo local, sem chave de IA configurada. Posso responder melhor sobre dados do SnoutSync: ${metrics.clientes} clientes, ${metrics.agendamentos_hoje} agendamentos hoje, ${metrics.servicos_realizados} servicos realizados e faturamento estimado de R$ ${toMoney(metrics.faturamento_mes).toFixed(2)}. Para responder qualquer tipo de pergunta, configure AI_API_KEY no .env.`;
}

async function askLanguageModel(question, context) {
  const apiKey = env.aiApiKey;
  if (!apiKey) return null;

  const baseUrl = env.aiBaseUrl.replace(/\/$/, '');
  const model = env.aiModel;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'Voce e a IA do SnoutSync, um sistema web de pet shop. Responda em portugues do Brasil, de forma objetiva e util. Voce pode responder perguntas gerais, mas quando a pergunta for sobre o negocio use somente o contexto JSON fornecido. Nao invente dados do banco. Se faltarem dados, diga exatamente o que falta.'
        },
        {
          role: 'system',
          content: `Contexto atual do PostgreSQL conectado:\n${JSON.stringify(context, null, 2)}`
        },
        { role: 'user', content: question }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha na IA configurada: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  const { rows } = await query('SELECT current_database() AS database, current_user AS user, NOW() AS now');
  ok(res, { postgres: rows[0], uptime: process.uptime() });
}));

app.post('/api/auth/login', authRateLimit, asyncRoute(async (req, res) => {
  const usuario = required(req.body.usuario, 'usuario');
  const senha = required(req.body.senha, 'senha');
  const { rows } = await query(
    `SELECT id, nome, usuario, senha, perfil::text AS perfil
       FROM usuario
      WHERE usuario = $1 AND ativo = true
      LIMIT 1`,
    [usuario]
  );
  if (!rows[0] || !(await verifyPassword(senha, rows[0].senha, rows[0].id))) {
    throw unauthorized('Usuario ou senha invalidos.');
  }
  const { senha: _senha, ...user } = rows[0];
  ok(res, { user, token: signToken(user) });
}));

app.use('/api', requireAuth);

app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  ok(res, await dashboardData());
}));

app.get('/api/clientes', asyncRoute(async (req, res) => {
  ok(res, await listClientes(req.query.search || ''));
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
  created(res, { id: result });
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
  ok(res, { updated: true });
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
  ok(res, { deleted: true });
}));

app.get('/api/pets', asyncRoute(async (_req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.nome, p.porte::text AS porte, c.id AS cliente_id, c.nome AS cliente_nome
       FROM pet p JOIN cliente c ON c.id = p.cliente_id
      ORDER BY c.nome, p.nome`
  );
  ok(res, rows);
}));

app.get('/api/pets/:id/historico', asyncRoute(async (req, res) => {
  const petId = Number(req.params.id);
  const [agenda, historico] = await Promise.all([
    query(
      `SELECT a.id, a.data::text AS data, a.hora::text AS hora, a.status::text AS status,
              a.observacoes, s.nome AS servico_nome, at.valor_cobrado, at.forma_pagamento, at.data_hora_conclusao::text AS data_hora_conclusao
         FROM agendamento a
         JOIN servico s ON s.id = a.servico_id
         LEFT JOIN atendimento at ON at.agendamento_id = a.id
        WHERE a.pet_id = $1
        ORDER BY a.data DESC, a.hora DESC`,
      [petId]
    ),
    query('SELECT id, tipo, descricao, criado_em::text AS criado_em FROM historico_pet WHERE pet_id = $1 ORDER BY criado_em DESC', [petId])
  ]);
  ok(res, { agendamentos: agenda.rows, historico: historico.rows });
}));

app.get('/api/servicos', asyncRoute(async (_req, res) => {
  const { rows } = await query('SELECT * FROM servico ORDER BY nome');
  ok(res, rows);
}));

app.post('/api/servicos', asyncRoute(async (req, res) => {
  const body = req.body;
  const { rows } = await query(
    `INSERT INTO servico (nome, descricao, preco_pequeno, preco_medio, preco_grande, duracao_pequeno, duracao_medio, duracao_grande)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      required(body.nome, 'nome'),
      body.descricao || null,
      validateMoney(body.preco_pequeno, 'preco_pequeno'),
      validateMoney(body.preco_medio, 'preco_medio'),
      validateMoney(body.preco_grande, 'preco_grande'),
      Number(required(body.duracao_pequeno, 'duracao_pequeno')),
      Number(required(body.duracao_medio, 'duracao_medio')),
      Number(required(body.duracao_grande, 'duracao_grande'))
    ]
  );
  created(res, rows[0]);
}));

app.put('/api/servicos/:id', asyncRoute(async (req, res) => {
  const body = req.body;
  const { rows } = await query(
    `UPDATE servico
        SET nome = $1, descricao = $2, preco_pequeno = $3, preco_medio = $4, preco_grande = $5,
            duracao_pequeno = $6, duracao_medio = $7, duracao_grande = $8
      WHERE id = $9
      RETURNING *`,
    [
      required(body.nome, 'nome'),
      body.descricao || null,
      validateMoney(body.preco_pequeno, 'preco_pequeno'),
      validateMoney(body.preco_medio, 'preco_medio'),
      validateMoney(body.preco_grande, 'preco_grande'),
      Number(required(body.duracao_pequeno, 'duracao_pequeno')),
      Number(required(body.duracao_medio, 'duracao_medio')),
      Number(required(body.duracao_grande, 'duracao_grande')),
      req.params.id
    ]
  );
  if (!rows[0]) throw notFound('Servico nao encontrado.');
  ok(res, rows[0]);
}));

app.delete('/api/servicos/:id', asyncRoute(async (req, res) => {
  const used = await query('SELECT id FROM agendamento WHERE servico_id = $1 LIMIT 1', [req.params.id]);
  if (used.rows[0]) throw conflict('Servico ja possui agendamentos e nao pode ser excluido.');
  await query('DELETE FROM servico WHERE id = $1', [req.params.id]);
  ok(res, { deleted: true });
}));

app.get('/api/agendamentos', asyncRoute(async (req, res) => {
  ok(res, await listAgendamentos(req.query));
}));

app.post('/api/agendamentos', asyncRoute(async (req, res) => {
  const body = req.body;
  const petId = Number(required(body.pet_id, 'pet_id'));
  const servicoId = Number(required(body.servico_id, 'servico_id'));
  const data = validateDate(body.data);
  const hora = validateTime(body.hora);
  const status = validateEnum(statusDb[body.status] || body.status || 'AGENDADO', ['AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'], 'status');
  if (status !== 'CANCELADO') await assertNoScheduleConflict({ petId, servicoId, data, hora });
  const { rows } = await query(
    `INSERT INTO agendamento (pet_id, servico_id, data, hora, status, observacoes)
     VALUES ($1, $2, $3, $4, $5::status_agendamento, $6)
     RETURNING id`,
    [petId, servicoId, data, hora, status, body.observacoes || null]
  );
  created(res, { id: rows[0].id });
}));

app.put('/api/agendamentos/:id', asyncRoute(async (req, res) => {
  const body = req.body;
  const petId = Number(required(body.pet_id, 'pet_id'));
  const servicoId = Number(required(body.servico_id, 'servico_id'));
  const data = validateDate(body.data);
  const hora = validateTime(body.hora);
  const status = validateEnum(statusDb[body.status] || body.status || 'AGENDADO', ['AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'], 'status');
  if (status !== 'CANCELADO') await assertNoScheduleConflict({ petId, servicoId, data, hora, excludeId: Number(req.params.id) });
  await query(
    `UPDATE agendamento
        SET pet_id = $1, servico_id = $2, data = $3, hora = $4, status = $5::status_agendamento, observacoes = $6
      WHERE id = $7`,
    [petId, servicoId, data, hora, status, body.observacoes || null, req.params.id]
  );
  ok(res, { updated: true });
}));

app.post('/api/agendamentos/:id/concluir', asyncRoute(async (req, res) => {
  const agendamentoId = Number(req.params.id);
  const valor = validateMoney(req.body.valor_cobrado, 'valor_cobrado');
  const forma = required(req.body.forma_pagamento, 'forma_pagamento');

  await transaction(async (client) => {
    const agendamento = await client.query('SELECT pet_id FROM agendamento WHERE id = $1', [agendamentoId]);
    if (!agendamento.rows[0]) {
      throw notFound('Agendamento nao encontrado.');
    }

    await client.query('UPDATE agendamento SET status = $1::status_agendamento WHERE id = $2', ['CONCLUIDO', agendamentoId]);
    await client.query(
      `INSERT INTO atendimento (agendamento_id, valor_cobrado, forma_pagamento, data_hora_conclusao)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (agendamento_id)
       DO UPDATE SET valor_cobrado = EXCLUDED.valor_cobrado, forma_pagamento = EXCLUDED.forma_pagamento, data_hora_conclusao = NOW()`,
      [agendamentoId, valor, forma]
    );
    await client.query(
      `INSERT INTO historico_pet (pet_id, agendamento_id, tipo, descricao)
       VALUES ($1, $2, 'ATENDIMENTO', $3)`,
      [agendamento.rows[0].pet_id, agendamentoId, `Atendimento concluido. Pagamento: ${forma}. Valor: R$ ${valor.toFixed(2)}.`]
    );
  });

  ok(res, { deleted: true });
}));

app.delete('/api/agendamentos/:id', asyncRoute(async (req, res) => {
  await transaction(async (client) => {
    await client.query('DELETE FROM atendimento WHERE agendamento_id = $1', [req.params.id]);
    await client.query('DELETE FROM agendamento WHERE id = $1', [req.params.id]);
  });
  ok(res, { completed: true });
}));

app.get('/api/financeiro', asyncRoute(async (_req, res) => {
  ok(res, await financeiroData());
}));

app.get('/api/relatorios/financeiro.csv', asyncRoute(async (_req, res) => {
  const financeiro = await financeiroData();
  const rows = ['data,descricao,categoria,valor,status'];
  for (const item of financeiro.lancamentos) {
    rows.push([item.data, item.descricao, item.categoria, item.valor, item.status].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
  }
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="financeiro-snoutsync.csv"');
  res.send(rows.join('\n'));
}));

app.get('/api/relatorios/financeiro.pdf', asyncRoute(async (_req, res) => {
  const financeiro = await financeiroData();
  const doc = new PDFDocument({ margin: 42 });
  res.header('Content-Type', 'application/pdf');
  res.header('Content-Disposition', 'attachment; filename="financeiro-snoutsync.pdf"');
  doc.pipe(res);
  doc.fontSize(20).text('Relatorio Financeiro - SnoutSync');
  doc.moveDown();
  doc.fontSize(12).text(`Receitas: R$ ${financeiro.resumo.receitas.toFixed(2)}`);
  doc.text(`Despesas: R$ ${financeiro.resumo.despesas.toFixed(2)}`);
  doc.text(`Lucro: R$ ${financeiro.resumo.lucro.toFixed(2)}`);
  doc.text(`Em aberto: R$ ${financeiro.resumo.aberto.toFixed(2)}`);
  doc.moveDown();
  doc.fontSize(14).text('Lancamentos');
  doc.moveDown(0.5);
  financeiro.lancamentos.forEach((item) => {
    doc.fontSize(10).text(`${item.data} | ${item.descricao} | R$ ${Number(item.valor).toFixed(2)} | ${item.status}`);
  });
  doc.end();
}));

app.get('/api/ai/status', (_req, res) => {
  ok(res, {
    configured: Boolean(env.aiApiKey),
    model: env.aiModel,
    baseUrl: env.aiBaseUrl
  });
});

app.post('/api/ai/ask', asyncRoute(async (req, res) => {
  const question = String(req.body.question || '').trim();
  if (!question) {
    throw badRequest('Envie uma pergunta.');
  }

  const context = await aiContext(question);
  let aiWarning = null;
  let modelAnswer = null;
  try {
    modelAnswer = await askLanguageModel(question, context);
  } catch (error) {
    aiWarning = error.message;
  }
  const answer = modelAnswer || localAiFallback(question, context);

  ok(res, {
    answer,
    source: modelAnswer ? 'LLM configurada com contexto do PostgreSQL conectado' : 'Fallback local com contexto do PostgreSQL conectado',
    aiConfigured: Boolean(env.aiApiKey),
    aiUsed: Boolean(modelAnswer),
    warning: aiWarning
  });
}));

app.use(notFoundHandler);
app.use(errorHandler);

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

ensureSchema()
  .then(() => {
    app.listen(env.port, () => {
      console.log(`SnoutSync API rodando em http://localhost:${env.port}`);
    });
  })
  .catch((error) => {
    console.error('Nao foi possivel preparar o banco:', error);
    process.exit(1);
  });
