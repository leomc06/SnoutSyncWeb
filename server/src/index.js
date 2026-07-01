import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import { pool, query, transaction } from './db.js';
import { env, assertProductionEnv } from './config/env.js';
import { ensureSchema } from './database/ensureSchema.js';
import { blacklistAccessToken, createPasswordResetToken, createRefreshToken, hashOpaqueToken, hashPassword, requireAuth, requireRole, revokeRefreshToken, revokeUserRefreshTokens, rotateRefreshToken, signToken, verifyPassword } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/errors.js';
import { apiRateLimit, authRateLimit, compressionMiddleware, corsMiddleware, requestId, securityHeaders } from './middlewares/security.js';
import { asyncRoute, badRequest, conflict, created, forbidden, notFound, ok, unauthorized } from './utils/http.js';
import { required, validateDate, validateEnum, validateMoney, validatePositiveInt, validateStrongPassword, validateTime } from './utils/validators.js';
import { sendEmail, sendPasswordResetEmail, sendWhatsApp } from './services/email.js';
import { audit } from './utils/audit.js';

const app = express();
assertProductionEnv();
const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
const petUploadDir = path.join(uploadRoot, 'pets');
fs.mkdirSync(petUploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, petUploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname || '')}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.set('trust proxy', 1);
app.use(requestId);
app.use(securityHeaders);
app.use(compressionMiddleware);
app.use(corsMiddleware());
app.use(apiRateLimit);
app.use('/uploads', express.static(uploadRoot));
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

function empresaId(req) {
  return req.user?.empresa_id || 1;
}

function optionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === 'SIM') return true;
  if (value === false || value === 'false' || value === 'NAO') return false;
  return Boolean(value);
}

async function notifySchedule(req, agendamentoId, action) {
  try {
    const { rows } = await query(
      `SELECT a.data::text AS data, a.hora::text AS hora, c.nome AS cliente_nome, c.telefone,
              p.nome AS pet_nome, s.nome AS servico_nome
         FROM agendamento a
         JOIN pet p ON p.id = a.pet_id
         JOIN cliente c ON c.id = p.cliente_id
         JOIN servico s ON s.id = a.servico_id
        WHERE a.id = $1
        LIMIT 1`,
      [agendamentoId]
    );
    const item = rows[0];
    if (!item) return;
    const text = `SnoutSync: ${action} para ${item.pet_nome} (${item.servico_nome}) em ${item.data} as ${String(item.hora).slice(0, 5)}.`;
    if (item.telefone) {
      await sendWhatsApp({ to: item.telefone, text, metadata: { agendamentoId, action } });
    }
  } catch (error) {
    console.error({ requestId: req.id, notificationError: error.message });
  }
}

const planLimits = {
  FILHOTE: { lojas: 1, usuarios: 2, agendamentosMes: 200 },
  ADULTO: { lojas: 3, usuarios: 10, agendamentosMes: 2000 },
  ALPHA: { lojas: 999, usuarios: 999, agendamentosMes: 999999 }
};

async function activeSubscription(empresaIdValue) {
  const { rows } = await query(
    `SELECT plano, limite_lojas, limite_usuarios, limite_agendamentos_mes
       FROM empresa_assinatura
      WHERE empresa_id = $1 AND status = 'ATIVA'
      ORDER BY id DESC
      LIMIT 1`,
    [empresaIdValue]
  );
  return rows[0] || { plano: 'FILHOTE', limite_lojas: 1, limite_usuarios: 2, limite_agendamentos_mes: 200 };
}

async function assertSubscriptionLimit(req, scheduleDate) {
  const subscription = await activeSubscription(empresaId(req));
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total
       FROM agendamento
      WHERE empresa_id = $1
        AND date_trunc('month', data::timestamp) = date_trunc('month', $2::date::timestamp)`,
    [empresaId(req), scheduleDate]
  );
  if (rows[0].total >= subscription.limite_agendamentos_mes) {
    throw forbidden(`Limite mensal de agendamentos do plano ${subscription.plano} atingido.`);
  }
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
    profissional_id: row.profissional_id || null,
    profissional_nome: row.profissional_nome || 'Sem profissional',
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

async function assertNoScheduleConflict({ petId, servicoId, data, hora, profissionalId = null, excludeId = null }) {
  const params = [petId, servicoId, data, hora, excludeId, profissionalId];
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
           AND ($6::int IS NULL OR a.profissional_id = $6::int)
     )
     SELECT e.*
       FROM existentes e
       CROSS JOIN novo n
      WHERE e.inicio < n.fim AND e.fim > n.inicio
      LIMIT 1`,
    params
  );

  if (rows[0]) {
    throw conflict(`Conflito de horario com ${rows[0].pet_nome} (${rows[0].servico_nome}) para este profissional.`, rows[0]);
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

async function listAgendamentos({ data, status, search, dataInicio, dataFim, servicoId } = {}) {
  const params = [];
  const filters = [];

  if (data) {
    params.push(data);
    filters.push(`a.data = $${params.length}`);
  }
  if (dataInicio) {
    params.push(dataInicio);
    filters.push(`a.data >= $${params.length}`);
  }
  if (dataFim) {
    params.push(dataFim);
    filters.push(`a.data <= $${params.length}`);
  }
  if (servicoId) {
    params.push(Number(servicoId));
    filters.push(`a.servico_id = $${params.length}`);
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
    `SELECT a.id, a.pet_id, a.servico_id, a.profissional_id, pr.nome AS profissional_nome, p.cliente_id, c.nome AS cliente_nome,
            p.nome AS pet_nome, s.nome AS servico_nome, a.data::text AS data, a.hora::text AS hora,
            a.status::text AS status, a.observacoes, ${valorServicoSql} AS valor_estimado,
            at.id AS atendimento_id, at.valor_cobrado, at.forma_pagamento, at.data_hora_conclusao::text AS data_hora_conclusao
       FROM agendamento a
       JOIN pet p ON p.id = a.pet_id
       JOIN cliente c ON c.id = p.cliente_id
       JOIN servico s ON s.id = a.servico_id
       LEFT JOIN profissional pr ON pr.id = a.profissional_id
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

function normalizePeriod(queryParams = {}) {
  const dataInicio = queryParams.dataInicio || queryParams.inicio || null;
  const dataFim = queryParams.dataFim || queryParams.fim || null;
  const servicoId = queryParams.servicoId || queryParams.servico_id || null;
  if (dataInicio) validateDate(dataInicio, 'dataInicio');
  if (dataFim) validateDate(dataFim, 'dataFim');
  return { dataInicio, dataFim, servicoId: servicoId ? validatePositiveInt(servicoId, 'servicoId') : null };
}

function buildFinanceFilters(filters, alias = 'a') {
  const params = [];
  const where = [];
  if (filters.dataInicio) {
    params.push(filters.dataInicio);
    where.push(`${alias}.data >= $${params.length}`);
  }
  if (filters.dataFim) {
    params.push(filters.dataFim);
    where.push(`${alias}.data <= $${params.length}`);
  }
  if (filters.servicoId) {
    params.push(filters.servicoId);
    where.push(`${alias}.servico_id = $${params.length}`);
  }
  return { params, where: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

async function financeiroData(filters = {}) {
  const agFilters = buildFinanceFilters(filters, 'a');
  const despesaParams = [];
  const despesaWhere = ['ativo = true'];
  if (filters.dataInicio) {
    despesaParams.push(filters.dataInicio);
    despesaWhere.push(`data_vencimento >= $${despesaParams.length}`);
  }
  if (filters.dataFim) {
    despesaParams.push(filters.dataFim);
    despesaWhere.push(`data_vencimento <= $${despesaParams.length}`);
  }

  const { rows } = await query(`
    WITH ag AS (
      SELECT a.id, a.data, a.status::text AS status, p.nome AS pet_nome, s.nome AS servico_nome, ${valorServicoSql} AS valor_estimado
        FROM agendamento a
        JOIN pet p ON p.id = a.pet_id
        JOIN servico s ON s.id = a.servico_id
        ${agFilters.where}
    ), plan AS (
        SELECT COALESCE(SUM(preco_mensal), 0) AS receita_planos FROM plano
    )
    SELECT
      ((SELECT receita_planos FROM plan) + COALESCE((SELECT SUM(valor_estimado) FROM ag WHERE status <> 'CANCELADO'), 0))::numeric AS receitas,
      COALESCE((SELECT SUM(valor_estimado) FROM ag WHERE status = 'EM_ANDAMENTO'), 0)::numeric AS aberto
  `, agFilters.params);

  const despesasRows = (await query(
    `SELECT id, descricao, categoria, valor, data_vencimento::text AS data_vencimento, data_pagamento::text AS data_pagamento, status
       FROM despesa
      WHERE ${despesaWhere.join(' AND ')}
      ORDER BY data_vencimento DESC, id DESC`,
    despesaParams
  )).rows;

  const receitas = toMoney(rows[0].receitas);
  const despesas = despesasRows.reduce((sum, item) => sum + toMoney(item.valor), 0);
  const lancamentos = await listAgendamentos(filters);

  return {
    resumo: {
      receitas,
      despesas,
      lucro: receitas - despesas,
      aberto: toMoney(rows[0].aberto)
    },
    lancamentos: [
      ...lancamentos.map((item) => ({
      id: item.id,
      data: item.data,
      descricao: `${item.servico_nome} - ${item.pet_nome}`,
      categoria: 'Servicos',
      valor: item.status === 'CANCELADO' ? 0 : item.valor_estimado,
      status: item.status === 'EM_ANDAMENTO' ? 'Aberto' : item.status === 'CANCELADO' ? 'Cancelado' : 'Pago'
      })),
      ...despesasRows.map((item) => ({
        id: `d-${item.id}`,
        data: item.data_pagamento || item.data_vencimento,
        descricao: item.descricao,
        categoria: item.categoria,
        valor: -toMoney(item.valor),
        status: item.status
      }))
    ]
  };
}

async function relatorioServicosData(filters = {}) {
  const agFilters = buildFinanceFilters(filters, 'a');
  const { rows } = await query(
    `SELECT s.id AS servico_id, s.nome AS servico_nome,
            COUNT(a.id)::int AS quantidade,
            COALESCE(SUM(CASE WHEN a.status <> 'CANCELADO' THEN ${valorServicoSql} ELSE 0 END), 0)::numeric AS receita,
            COALESCE(AVG(CASE WHEN a.status <> 'CANCELADO' THEN ${valorServicoSql} END), 0)::numeric AS ticket_medio
       FROM agendamento a
       JOIN pet p ON p.id = a.pet_id
       JOIN servico s ON s.id = a.servico_id
      ${agFilters.where}
      GROUP BY s.id, s.nome
      ORDER BY receita DESC, quantidade DESC, s.nome`,
    agFilters.params
  );
  return rows.map((row) => ({
    servico_id: row.servico_id,
    servico_nome: row.servico_nome,
    quantidade: row.quantidade,
    receita: toMoney(row.receita),
    ticket_medio: toMoney(row.ticket_medio)
  }));
}

async function biData(filters = {}) {
  const agFilters = buildFinanceFilters(filters, 'a');
  const [servicos, semana, sazonalidade, estoque] = await Promise.all([
    relatorioServicosData(filters),
    query(
      `SELECT EXTRACT(DOW FROM a.data)::int AS dia_semana,
              COUNT(*)::int AS agendamentos,
              COALESCE(SUM(CASE WHEN a.status <> 'CANCELADO' THEN ${valorServicoSql} ELSE 0 END), 0)::numeric AS receita
         FROM agendamento a
         JOIN pet p ON p.id = a.pet_id
         JOIN servico s ON s.id = a.servico_id
        ${agFilters.where}
        GROUP BY dia_semana
        ORDER BY dia_semana`,
      agFilters.params
    ),
    query(
      `SELECT to_char(a.data, 'YYYY-MM') AS mes,
              COUNT(*)::int AS agendamentos,
              COALESCE(SUM(CASE WHEN a.status <> 'CANCELADO' THEN ${valorServicoSql} ELSE 0 END), 0)::numeric AS receita
         FROM agendamento a
         JOIN pet p ON p.id = a.pet_id
         JOIN servico s ON s.id = a.servico_id
        ${agFilters.where}
        GROUP BY mes
        ORDER BY mes`,
      agFilters.params
    ),
    query('SELECT COUNT(*)::int AS produtos, COUNT(*) FILTER (WHERE estoque_atual <= estoque_minimo)::int AS abaixo_minimo FROM produto WHERE ativo = true')
  ]);
  const receitaTotal = sazonalidade.rows.reduce((sum, row) => sum + toMoney(row.receita), 0);
  const meses = Math.max(sazonalidade.rows.length, 1);
  return {
    servicos_top: servicos.slice(0, 5),
    demanda_por_dia_semana: semana.rows.map((row) => ({ ...row, receita: toMoney(row.receita) })),
    sazonalidade_mensal: sazonalidade.rows.map((row) => ({ ...row, receita: toMoney(row.receita) })),
    previsao_demanda: {
      receita_media_mensal: receitaTotal / meses,
      agendamentos_media_mensal: sazonalidade.rows.reduce((sum, row) => sum + Number(row.agendamentos || 0), 0) / meses,
      metodo: 'media historica simples dos meses filtrados'
    },
    estoque: estoque.rows[0]
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
    `SELECT id, nome, usuario, senha, perfil::text AS perfil, COALESCE(empresa_id, 1) AS empresa_id
       FROM usuario
      WHERE usuario = $1 AND ativo = true
      LIMIT 1`,
    [usuario]
  );
  if (!rows[0] || !(await verifyPassword(senha, rows[0].senha, rows[0].id))) {
    throw unauthorized('Usuario ou senha invalidos.');
  }
  const { senha: _senha, ...user } = rows[0];
  const refresh = await createRefreshToken(user, req);
  req.user = user;
  await audit(req, { action: 'auth.login', entityType: 'usuario', entityId: user.id });
  ok(res, { user, token: signToken(user), refreshToken: refresh.token, refreshTokenExpiresAt: refresh.expiresAt });
}));

app.post('/api/auth/refresh', authRateLimit, asyncRoute(async (req, res) => {
  const refreshToken = required(req.body.refreshToken, 'refreshToken');
  const session = await rotateRefreshToken(refreshToken, req);
  req.user = session.user;
  await audit(req, { action: 'auth.refresh', entityType: 'usuario', entityId: session.user.id });
  ok(res, { ...session, token: signToken(session.user) });
}));

app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => {
  await Promise.all([
    blacklistAccessToken(req.accessToken, 'logout'),
    revokeRefreshToken(req.body.refreshToken, req.user.id)
  ]);
  await audit(req, { action: 'auth.logout', entityType: 'usuario', entityId: req.user.id });
  ok(res, { loggedOut: true });
}));

app.post('/api/auth/password-reset/request', authRateLimit, asyncRoute(async (req, res) => {
  const usuario = required(req.body.usuario, 'usuario');
  const { rows } = await query(
    `SELECT id, nome, usuario
       FROM usuario
      WHERE usuario = $1 AND ativo = true
      LIMIT 1`,
    [usuario]
  );

  if (rows[0]) {
    const reset = createPasswordResetToken();
    const expiresAt = new Date(Date.now() + env.passwordResetExpiresMinutes * 60 * 1000);
    await query(
      `INSERT INTO password_reset_token (usuario_id, token_hash, expires_at, ip_address, user_agent, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $1, $1)`,
      [rows[0].id, reset.tokenHash, expiresAt, req.ip || null, req.headers['user-agent'] || null]
    );
    await sendPasswordResetEmail({ to: rows[0].usuario, name: rows[0].nome, token: reset.token });
    req.user = { id: rows[0].id, usuario: rows[0].usuario, nome: rows[0].nome };
    await audit(req, { action: 'auth.password_reset_requested', entityType: 'usuario', entityId: rows[0].id });
  }

  ok(res, { message: 'Se o usuario existir, as instrucoes de recuperacao serao enviadas.' });
}));

app.post('/api/auth/password-reset/confirm', authRateLimit, asyncRoute(async (req, res) => {
  const token = required(req.body.token, 'token');
  const novaSenha = validateStrongPassword(req.body.novaSenha || req.body.senha, 'novaSenha');
  const tokenHash = hashOpaqueToken(token);

  await transaction(async (client) => {
    const found = await client.query(
      `SELECT prt.id, prt.usuario_id, u.nome, u.usuario, u.perfil::text AS perfil
         FROM password_reset_token prt
         JOIN usuario u ON u.id = prt.usuario_id
        WHERE prt.token_hash = $1 AND prt.used_at IS NULL AND prt.expires_at > NOW() AND u.ativo = true
        LIMIT 1
        FOR UPDATE OF prt`,
      [tokenHash]
    );
    const row = found.rows[0];
    if (!row) throw unauthorized('Token de recuperacao invalido ou expirado.');

    await client.query('UPDATE usuario SET senha = $1 WHERE id = $2', [await hashPassword(novaSenha), row.usuario_id]);
    await client.query('UPDATE password_reset_token SET used_at = NOW(), updated_at = NOW(), updated_by = $1 WHERE id = $2', [row.usuario_id, row.id]);
    await client.query('UPDATE refresh_token SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW(), updated_by = $1 WHERE usuario_id = $1', [row.usuario_id]);
    req.user = { id: row.usuario_id, nome: row.nome, usuario: row.usuario, perfil: row.perfil };
  });

  await audit(req, { action: 'auth.password_reset_completed', entityType: 'usuario', entityId: req.user.id });
  ok(res, { updated: true });
}));

app.use('/api', requireAuth);

app.post('/api/auth/change-password', asyncRoute(async (req, res) => {
  const senhaAtual = required(req.body.senhaAtual, 'senhaAtual');
  const novaSenha = validateStrongPassword(req.body.novaSenha, 'novaSenha');
  const { rows } = await query('SELECT senha FROM usuario WHERE id = $1 AND ativo = true LIMIT 1', [req.user.id]);
  if (!rows[0] || !(await verifyPassword(senhaAtual, rows[0].senha, req.user.id))) {
    throw unauthorized('Senha atual invalida.');
  }
  await query('UPDATE usuario SET senha = $1 WHERE id = $2', [await hashPassword(novaSenha), req.user.id]);
  await revokeUserRefreshTokens(req.user.id);
  await audit(req, { action: 'auth.password_changed', entityType: 'usuario', entityId: req.user.id });
  ok(res, { updated: true });
}));

app.get('/api/admin/audit-logs', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 200);
  const { rows } = await query(
    `SELECT al.id, al.actor_user_id, u.nome AS actor_nome, al.action, al.entity_type, al.entity_id,
            al.metadata, al.ip_address, al.request_id, al.created_at::text AS created_at
       FROM audit_log al
       LEFT JOIN usuario u ON u.id = al.actor_user_id
      ORDER BY al.created_at DESC
      LIMIT $1`,
    [limit]
  );
  ok(res, rows);
}));

app.get('/api/admin/assinatura', requireRole('ADMIN', 'GERENTE'), asyncRoute(async (req, res) => {
  ok(res, await activeSubscription(empresaId(req)));
}));

app.put('/api/admin/assinatura', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const plano = validateEnum(req.body.plano, ['FILHOTE', 'ADULTO', 'ALPHA'], 'plano');
  const limits = planLimits[plano];
  await transaction(async (client) => {
    await client.query('UPDATE empresa_assinatura SET status = $1, updated_at = NOW() WHERE empresa_id = $2 AND status = $3', ['CANCELADA', empresaId(req), 'ATIVA']);
    await client.query(
      `INSERT INTO empresa_assinatura (empresa_id, plano, limite_lojas, limite_usuarios, limite_agendamentos_mes)
       VALUES ($1, $2, $3, $4, $5)`,
      [empresaId(req), plano, limits.lojas, limits.usuarios, limits.agendamentosMes]
    );
  });
  await audit(req, { action: 'assinatura.updated', entityType: 'empresa', entityId: empresaId(req), metadata: { plano } });
  ok(res, await activeSubscription(empresaId(req)));
}));

app.get('/api/lojas', requireRole('ADMIN', 'GERENTE'), asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT * FROM loja WHERE empresa_id = $1 AND ativo = true ORDER BY nome', [empresaId(req)]);
  ok(res, rows);
}));

app.post('/api/lojas', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const subscription = await activeSubscription(empresaId(req));
  const current = await query('SELECT COUNT(*)::int AS total FROM loja WHERE empresa_id = $1 AND ativo = true', [empresaId(req)]);
  if (current.rows[0].total >= subscription.limite_lojas) throw forbidden(`Limite de lojas do plano ${subscription.plano} atingido.`);
  const { rows } = await query(
    `INSERT INTO loja (empresa_id, nome, documento, email, endereco, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING *`,
    [empresaId(req), required(req.body.nome, 'nome'), req.body.documento || null, req.body.email || null, req.body.endereco || null, req.user.id]
  );
  await audit(req, { action: 'loja.created', entityType: 'loja', entityId: rows[0].id });
  created(res, rows[0]);
}));

app.get('/api/profissionais', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, l.nome AS loja_nome
       FROM profissional p
       LEFT JOIN loja l ON l.id = p.loja_id
      WHERE p.empresa_id = $1 AND p.ativo = true
      ORDER BY p.nome`,
    [empresaId(req)]
  );
  ok(res, rows);
}));

app.post('/api/profissionais', requireRole('ADMIN', 'GERENTE'), asyncRoute(async (req, res) => {
  const body = req.body;
  const { rows } = await query(
    `INSERT INTO profissional (empresa_id, loja_id, nome, documento, telefone, email, cargo, especialidade, especialidades, horario_inicio, horario_fim, dias_semana, observacoes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13, $14, $14)
     RETURNING *`,
    [
      empresaId(req),
      body.loja_id || req.user.loja_id || null,
      required(body.nome, 'nome'),
      body.documento || null,
      body.telefone || null,
      body.email || null,
      body.cargo || 'BANHISTA',
      body.especialidade || null,
      JSON.stringify(body.especialidades || []),
      body.horario_inicio || null,
      body.horario_fim || null,
      JSON.stringify(body.dias_semana || [1, 2, 3, 4, 5, 6]),
      body.observacoes || null,
      req.user.id
    ]
  );
  await audit(req, { action: 'profissional.created', entityType: 'profissional', entityId: rows[0].id });
  created(res, rows[0]);
}));

app.put('/api/profissionais/:id', requireRole('ADMIN', 'GERENTE'), asyncRoute(async (req, res) => {
  const body = req.body;
  const { rows } = await query(
    `UPDATE profissional
        SET loja_id = $1, nome = $2, documento = $3, telefone = $4, email = $5, cargo = $6,
            especialidade = $7, especialidades = $8::jsonb, horario_inicio = $9, horario_fim = $10,
            dias_semana = $11::jsonb, observacoes = $12, updated_at = NOW(), updated_by = $13
      WHERE id = $14 AND empresa_id = $15 AND ativo = true
      RETURNING *`,
    [body.loja_id || null, required(body.nome, 'nome'), body.documento || null, body.telefone || null, body.email || null, body.cargo || 'BANHISTA', body.especialidade || null, JSON.stringify(body.especialidades || []), body.horario_inicio || null, body.horario_fim || null, JSON.stringify(body.dias_semana || [1, 2, 3, 4, 5, 6]), body.observacoes || null, req.user.id, req.params.id, empresaId(req)]
  );
  if (!rows[0]) throw notFound('Profissional nao encontrado.');
  await audit(req, { action: 'profissional.updated', entityType: 'profissional', entityId: req.params.id });
  ok(res, rows[0]);
}));

app.delete('/api/profissionais/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const { rows } = await query('UPDATE profissional SET ativo = false, updated_at = NOW(), updated_by = $1 WHERE id = $2 AND empresa_id = $3 RETURNING id', [req.user.id, req.params.id, empresaId(req)]);
  if (!rows[0]) throw notFound('Profissional nao encontrado.');
  await audit(req, { action: 'profissional.deleted', entityType: 'profissional', entityId: req.params.id });
  ok(res, { deleted: true });
}));

app.get('/api/clientes/:id/telefones', asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT * FROM cliente_telefone WHERE cliente_id = $1 ORDER BY principal DESC, id', [req.params.id]);
  ok(res, rows);
}));

app.post('/api/clientes/:id/telefones', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `INSERT INTO cliente_telefone (cliente_id, numero, tipo, principal, whatsapp)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [req.params.id, required(req.body.numero, 'numero'), req.body.tipo || 'CELULAR', Boolean(req.body.principal), req.body.whatsapp !== false]
  );
  if (rows[0].principal) await query('UPDATE cliente SET telefone = $1 WHERE id = $2', [rows[0].numero, req.params.id]);
  await audit(req, { action: 'cliente_telefone.created', entityType: 'cliente', entityId: req.params.id });
  created(res, rows[0]);
}));

app.get('/api/despesas', asyncRoute(async (req, res) => {
  const filters = normalizePeriod(req.query);
  const params = [];
  const where = ['ativo = true'];
  if (filters.dataInicio) {
    params.push(filters.dataInicio);
    where.push(`data_vencimento >= $${params.length}`);
  }
  if (filters.dataFim) {
    params.push(filters.dataFim);
    where.push(`data_vencimento <= $${params.length}`);
  }
  const { rows } = await query(
    `SELECT id, descricao, categoria, valor, data_vencimento::text AS data_vencimento,
            data_pagamento::text AS data_pagamento, status, observacoes, ativo,
            created_at::text AS created_at, updated_at::text AS updated_at
       FROM despesa
      WHERE ${where.join(' AND ')}
      ORDER BY data_vencimento DESC, id DESC`,
    params
  );
  ok(res, rows);
}));

app.post('/api/despesas', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const body = req.body;
  const status = validateEnum(body.status || 'ABERTA', ['ABERTA', 'PAGA', 'CANCELADA'], 'status');
  const { rows } = await query(
    `INSERT INTO despesa (descricao, categoria, valor, data_vencimento, data_pagamento, status, observacoes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING *`,
    [
      required(body.descricao, 'descricao'),
      body.categoria || 'Operacional',
      validateMoney(body.valor, 'valor'),
      validateDate(body.data_vencimento || new Date().toISOString().slice(0, 10), 'data_vencimento'),
      body.data_pagamento ? validateDate(body.data_pagamento, 'data_pagamento') : null,
      status,
      body.observacoes || null,
      req.user.id
    ]
  );
  await audit(req, { action: 'despesa.created', entityType: 'despesa', entityId: rows[0].id });
  created(res, rows[0]);
}));

app.put('/api/despesas/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const body = req.body;
  const status = validateEnum(body.status || 'ABERTA', ['ABERTA', 'PAGA', 'CANCELADA'], 'status');
  const { rows } = await query(
    `UPDATE despesa
        SET descricao = $1, categoria = $2, valor = $3, data_vencimento = $4, data_pagamento = $5,
            status = $6, observacoes = $7, updated_at = NOW(), updated_by = $8
      WHERE id = $9 AND ativo = true
      RETURNING *`,
    [
      required(body.descricao, 'descricao'),
      body.categoria || 'Operacional',
      validateMoney(body.valor, 'valor'),
      validateDate(body.data_vencimento, 'data_vencimento'),
      body.data_pagamento ? validateDate(body.data_pagamento, 'data_pagamento') : null,
      status,
      body.observacoes || null,
      req.user.id,
      req.params.id
    ]
  );
  if (!rows[0]) throw notFound('Despesa nao encontrada.');
  await audit(req, { action: 'despesa.updated', entityType: 'despesa', entityId: req.params.id });
  ok(res, rows[0]);
}));

app.delete('/api/despesas/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const { rows } = await query('UPDATE despesa SET ativo = false, updated_at = NOW(), updated_by = $1 WHERE id = $2 RETURNING id', [req.user.id, req.params.id]);
  if (!rows[0]) throw notFound('Despesa nao encontrada.');
  await audit(req, { action: 'despesa.deleted', entityType: 'despesa', entityId: req.params.id });
  ok(res, { deleted: true });
}));

app.get('/api/produtos', asyncRoute(async (_req, res) => {
  const { rows } = await query(
    `SELECT p.*, COALESCE((
       SELECT json_agg(pm ORDER BY pm.created_at DESC)
         FROM (SELECT id, tipo, quantidade, estoque_anterior, estoque_novo, motivo, created_at::text AS created_at
                 FROM produto_movimentacao
                WHERE produto_id = p.id
                ORDER BY created_at DESC
                LIMIT 5) pm
     ), '[]'::json) AS ultimas_movimentacoes
       FROM produto p
      WHERE p.ativo = true
      ORDER BY p.nome`
  );
  ok(res, rows);
}));

app.post('/api/produtos', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const body = req.body;
  const { rows } = await query(
    `INSERT INTO produto (sku, nome, descricao, categoria, preco_venda, custo, estoque_atual, estoque_minimo, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     RETURNING *`,
    [
      body.sku || null,
      required(body.nome, 'nome'),
      body.descricao || null,
      body.categoria || null,
      validateMoney(body.preco_venda ?? 0, 'preco_venda'),
      validateMoney(body.custo ?? 0, 'custo'),
      Number(body.estoque_atual || 0),
      Number(body.estoque_minimo || 0),
      req.user.id
    ]
  );
  await audit(req, { action: 'produto.created', entityType: 'produto', entityId: rows[0].id });
  created(res, rows[0]);
}));

app.put('/api/produtos/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const body = req.body;
  const { rows } = await query(
    `UPDATE produto
        SET sku = $1, nome = $2, descricao = $3, categoria = $4, preco_venda = $5, custo = $6,
            estoque_minimo = $7, updated_at = NOW(), updated_by = $8
      WHERE id = $9 AND ativo = true
      RETURNING *`,
    [
      body.sku || null,
      required(body.nome, 'nome'),
      body.descricao || null,
      body.categoria || null,
      validateMoney(body.preco_venda ?? 0, 'preco_venda'),
      validateMoney(body.custo ?? 0, 'custo'),
      Number(body.estoque_minimo || 0),
      req.user.id,
      req.params.id
    ]
  );
  if (!rows[0]) throw notFound('Produto nao encontrado.');
  await audit(req, { action: 'produto.updated', entityType: 'produto', entityId: req.params.id });
  ok(res, rows[0]);
}));

app.post('/api/produtos/:id/movimentacoes', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const tipo = validateEnum(req.body.tipo, ['ENTRADA', 'SAIDA', 'AJUSTE'], 'tipo');
  const quantidade = Number(validatePositiveInt(req.body.quantidade, 'quantidade'));
  const result = await transaction(async (client) => {
    const produto = await client.query('SELECT id, estoque_atual FROM produto WHERE id = $1 AND ativo = true FOR UPDATE', [req.params.id]);
    if (!produto.rows[0]) throw notFound('Produto nao encontrado.');
    const anterior = Number(produto.rows[0].estoque_atual);
    const novo = tipo === 'ENTRADA' ? anterior + quantidade : tipo === 'SAIDA' ? anterior - quantidade : quantidade;
    if (novo < 0) throw badRequest('Estoque insuficiente para saida.', { field: 'quantidade' });
    await client.query('UPDATE produto SET estoque_atual = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3', [novo, req.user.id, req.params.id]);
    const mov = await client.query(
      `INSERT INTO produto_movimentacao (produto_id, tipo, quantidade, estoque_anterior, estoque_novo, motivo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.params.id, tipo, quantidade, anterior, novo, req.body.motivo || null, req.user.id]
    );
    return mov.rows[0];
  });
  await audit(req, { action: 'produto.stock_moved', entityType: 'produto', entityId: req.params.id, metadata: { tipo, quantidade } });
  created(res, result);
}));

app.delete('/api/produtos/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const { rows } = await query('UPDATE produto SET ativo = false, updated_at = NOW(), updated_by = $1 WHERE id = $2 RETURNING id', [req.user.id, req.params.id]);
  if (!rows[0]) throw notFound('Produto nao encontrado.');
  await audit(req, { action: 'produto.deleted', entityType: 'produto', entityId: req.params.id });
  ok(res, { deleted: true });
}));

app.get('/api/relatorios/servicos', asyncRoute(async (req, res) => {
  ok(res, await relatorioServicosData(normalizePeriod(req.query)));
}));

app.get('/api/bi', asyncRoute(async (req, res) => {
  ok(res, await biData(normalizePeriod(req.query)));
}));

app.get('/api/pets/:id/prontuario', asyncRoute(async (req, res) => {
  const petId = validatePositiveInt(req.params.id, 'id');
  const [prontuario, vacinas, medicacoes, alertas, anexos] = await Promise.all([
    query('SELECT *, updated_at::text AS updated_at FROM pet_prontuario WHERE pet_id = $1 LIMIT 1', [petId]),
    query('SELECT id, nome, data_aplicacao::text AS data_aplicacao, data_reforco::text AS data_reforco, observacoes, created_at::text AS created_at FROM pet_vacina WHERE pet_id = $1 ORDER BY COALESCE(data_reforco, data_aplicacao) DESC NULLS LAST, id DESC', [petId]),
    query('SELECT id, nome, dosagem, frequencia, data_inicio::text AS data_inicio, data_fim::text AS data_fim, observacoes FROM pet_medicacao WHERE pet_id = $1 AND ativo = true ORDER BY id DESC', [petId]),
    query('SELECT id, tipo, titulo, descricao, severidade FROM pet_alerta WHERE pet_id = $1 AND ativo = true ORDER BY id DESC', [petId]),
    query('SELECT id, nome_original, mime_type, tamanho, url, descricao, created_at::text AS created_at FROM pet_anexo WHERE pet_id = $1 ORDER BY created_at DESC', [petId])
  ]);
  ok(res, { prontuario: prontuario.rows[0] || null, vacinas: vacinas.rows, medicacoes: medicacoes.rows, alertas: alertas.rows, anexos: anexos.rows });
}));

app.put('/api/pets/:id/prontuario', asyncRoute(async (req, res) => {
  const petId = validatePositiveInt(req.params.id, 'id');
  const body = req.body;
  const { rows } = await query(
    `INSERT INTO pet_prontuario (pet_id, alergias, restricoes, comportamento, observacoes_clinicas, peso_atual, castrado, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (pet_id)
     DO UPDATE SET alergias = EXCLUDED.alergias,
                   restricoes = EXCLUDED.restricoes,
                   comportamento = EXCLUDED.comportamento,
                   observacoes_clinicas = EXCLUDED.observacoes_clinicas,
                   peso_atual = EXCLUDED.peso_atual,
                   castrado = EXCLUDED.castrado,
                   updated_at = NOW(),
                   updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [petId, body.alergias || null, body.restricoes || null, body.comportamento || null, body.observacoes_clinicas || null, body.peso_atual || null, optionalBoolean(body.castrado), req.user.id]
  );
  await audit(req, { action: 'pet_prontuario.updated', entityType: 'pet', entityId: petId });
  ok(res, rows[0]);
}));

app.post('/api/pets/:id/vacinas', asyncRoute(async (req, res) => {
  const petId = validatePositiveInt(req.params.id, 'id');
  const body = req.body;
  const { rows } = await query(
    `INSERT INTO pet_vacina (pet_id, nome, data_aplicacao, data_reforco, observacoes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING *`,
    [petId, required(body.nome, 'nome'), body.data_aplicacao ? validateDate(body.data_aplicacao, 'data_aplicacao') : null, body.data_reforco ? validateDate(body.data_reforco, 'data_reforco') : null, body.observacoes || null, req.user.id]
  );
  await audit(req, { action: 'pet_vacina.created', entityType: 'pet', entityId: petId, metadata: { vacinaId: rows[0].id } });
  created(res, rows[0]);
}));

app.delete('/api/pets/:petId/vacinas/:vacinaId', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const petId = validatePositiveInt(req.params.petId, 'petId');
  const vacinaId = validatePositiveInt(req.params.vacinaId, 'vacinaId');
  await query('DELETE FROM pet_vacina WHERE id = $1 AND pet_id = $2', [vacinaId, petId]);
  await audit(req, { action: 'pet_vacina.deleted', entityType: 'pet', entityId: petId, metadata: { vacinaId } });
  ok(res, { deleted: true });
}));

app.post('/api/pets/:id/medicacoes', asyncRoute(async (req, res) => {
  const petId = validatePositiveInt(req.params.id, 'id');
  const body = req.body;
  const { rows } = await query(
    `INSERT INTO pet_medicacao (pet_id, nome, dosagem, frequencia, data_inicio, data_fim, observacoes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING *`,
    [petId, required(body.nome, 'nome'), body.dosagem || null, body.frequencia || null, body.data_inicio ? validateDate(body.data_inicio, 'data_inicio') : null, body.data_fim ? validateDate(body.data_fim, 'data_fim') : null, body.observacoes || null, req.user.id]
  );
  await audit(req, { action: 'pet_medicacao.created', entityType: 'pet', entityId: petId, metadata: { medicacaoId: rows[0].id } });
  created(res, rows[0]);
}));

app.post('/api/pets/:id/alertas', asyncRoute(async (req, res) => {
  const petId = validatePositiveInt(req.params.id, 'id');
  const body = req.body;
  const severidade = validateEnum(body.severidade || 'MEDIA', ['BAIXA', 'MEDIA', 'ALTA'], 'severidade');
  const { rows } = await query(
    `INSERT INTO pet_alerta (pet_id, tipo, titulo, descricao, severidade, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING *`,
    [petId, body.tipo || 'GERAL', required(body.titulo, 'titulo'), body.descricao || null, severidade, req.user.id]
  );
  await audit(req, { action: 'pet_alerta.created', entityType: 'pet', entityId: petId, metadata: { alertaId: rows[0].id } });
  created(res, rows[0]);
}));

app.post('/api/pets/:id/anexos', upload.single('arquivo'), asyncRoute(async (req, res) => {
  const petId = validatePositiveInt(req.params.id, 'id');
  if (!req.file) throw badRequest('Arquivo obrigatorio.', { field: 'arquivo' });
  const relative = `/uploads/pets/${req.file.filename}`;
  const { rows } = await query(
    `INSERT INTO pet_anexo (pet_id, nome_original, arquivo, mime_type, tamanho, url, descricao, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [petId, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, relative, req.body.descricao || null, req.user.id]
  );
  await audit(req, { action: 'pet_anexo.uploaded', entityType: 'pet', entityId: petId, metadata: { anexoId: rows[0].id } });
  created(res, rows[0]);
}));

app.post('/api/notificacoes/email', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const result = await sendEmail({
    to: required(req.body.to, 'to'),
    subject: required(req.body.subject, 'subject'),
    text: required(req.body.text, 'text'),
    metadata: { manual: true, userId: req.user.id }
  });
  await audit(req, { action: 'notification.email_sent', entityType: 'notification', metadata: result });
  ok(res, result);
}));

app.post('/api/notificacoes/whatsapp', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const result = await sendWhatsApp({
    to: required(req.body.to, 'to'),
    text: required(req.body.text, 'text'),
    metadata: { manual: true, userId: req.user.id }
  });
  await audit(req, { action: 'notification.whatsapp_sent', entityType: 'notification', metadata: result });
  ok(res, result);
}));

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
  await audit(req, { action: 'cliente.created', entityType: 'cliente', entityId: result });
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
  await audit(req, { action: 'cliente.updated', entityType: 'cliente', entityId: clienteId, metadata: { petId } });
  ok(res, { updated: true });
}));

app.delete('/api/clientes/:clienteId', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const clienteId = Number(req.params.clienteId);
  await transaction(async (client) => {
    await client.query(`DELETE FROM atendimento WHERE agendamento_id IN (SELECT a.id FROM agendamento a JOIN pet p ON p.id = a.pet_id WHERE p.cliente_id = $1)`, [clienteId]);
    await client.query(`DELETE FROM agendamento WHERE pet_id IN (SELECT id FROM pet WHERE cliente_id = $1)`, [clienteId]);
    await client.query('DELETE FROM plano WHERE cliente_id = $1', [clienteId]);
    await client.query('DELETE FROM pet WHERE cliente_id = $1', [clienteId]);
    await client.query('DELETE FROM cliente WHERE id = $1', [clienteId]);
  });
  await audit(req, { action: 'cliente.deleted', entityType: 'cliente', entityId: clienteId });
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

app.post('/api/servicos', requireRole('ADMIN'), asyncRoute(async (req, res) => {
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
  await audit(req, { action: 'servico.created', entityType: 'servico', entityId: rows[0].id });
  created(res, rows[0]);
}));

app.put('/api/servicos/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
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
  await audit(req, { action: 'servico.updated', entityType: 'servico', entityId: req.params.id });
  ok(res, rows[0]);
}));

app.delete('/api/servicos/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const used = await query('SELECT id FROM agendamento WHERE servico_id = $1 LIMIT 1', [req.params.id]);
  if (used.rows[0]) throw conflict('Servico ja possui agendamentos e nao pode ser excluido.');
  await query('DELETE FROM servico WHERE id = $1', [req.params.id]);
  await audit(req, { action: 'servico.deleted', entityType: 'servico', entityId: req.params.id });
  ok(res, { deleted: true });
}));

app.get('/api/agendamentos', asyncRoute(async (req, res) => {
  ok(res, await listAgendamentos(req.query));
}));

app.post('/api/agendamentos', asyncRoute(async (req, res) => {
  const body = req.body;
  const petId = Number(required(body.pet_id, 'pet_id'));
  const servicoId = Number(required(body.servico_id, 'servico_id'));
  const profissionalId = body.profissional_id ? Number(validatePositiveInt(body.profissional_id, 'profissional_id')) : null;
  const data = validateDate(body.data);
  const hora = validateTime(body.hora);
  const status = validateEnum(statusDb[body.status] || body.status || 'AGENDADO', ['AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'], 'status');
  await assertSubscriptionLimit(req, data);
  if (status !== 'CANCELADO') await assertNoScheduleConflict({ petId, servicoId, data, hora, profissionalId });
  const { rows } = await query(
    `INSERT INTO agendamento (pet_id, servico_id, profissional_id, empresa_id, loja_id, data, hora, status, observacoes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::status_agendamento, $9)
     RETURNING id`,
    [petId, servicoId, profissionalId, empresaId(req), req.user.loja_id || null, data, hora, status, body.observacoes || null]
  );
  await audit(req, { action: 'agendamento.created', entityType: 'agendamento', entityId: rows[0].id });
  await notifySchedule(req, rows[0].id, 'agendamento criado');
  created(res, { id: rows[0].id });
}));

app.put('/api/agendamentos/:id', asyncRoute(async (req, res) => {
  const body = req.body;
  const petId = Number(required(body.pet_id, 'pet_id'));
  const servicoId = Number(required(body.servico_id, 'servico_id'));
  const profissionalId = body.profissional_id ? Number(validatePositiveInt(body.profissional_id, 'profissional_id')) : null;
  const data = validateDate(body.data);
  const hora = validateTime(body.hora);
  const status = validateEnum(statusDb[body.status] || body.status || 'AGENDADO', ['AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'], 'status');
  if (status !== 'CANCELADO') await assertNoScheduleConflict({ petId, servicoId, data, hora, profissionalId, excludeId: Number(req.params.id) });
  await query(
    `UPDATE agendamento
        SET pet_id = $1, servico_id = $2, profissional_id = $3, data = $4, hora = $5, status = $6::status_agendamento, observacoes = $7
      WHERE id = $8`,
    [petId, servicoId, profissionalId, data, hora, status, body.observacoes || null, req.params.id]
  );
  await audit(req, { action: 'agendamento.updated', entityType: 'agendamento', entityId: req.params.id });
  await notifySchedule(req, req.params.id, 'agendamento atualizado');
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

  await audit(req, { action: 'agendamento.completed', entityType: 'agendamento', entityId: agendamentoId, metadata: { valor, forma } });
  ok(res, { deleted: true });
}));

app.delete('/api/agendamentos/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  await transaction(async (client) => {
    await client.query('DELETE FROM atendimento WHERE agendamento_id = $1', [req.params.id]);
    await client.query('DELETE FROM agendamento WHERE id = $1', [req.params.id]);
  });
  await audit(req, { action: 'agendamento.deleted', entityType: 'agendamento', entityId: req.params.id });
  ok(res, { completed: true });
}));

app.get('/api/financeiro', asyncRoute(async (req, res) => {
  ok(res, await financeiroData(normalizePeriod(req.query)));
}));

app.get('/api/relatorios/financeiro.csv', asyncRoute(async (req, res) => {
  const financeiro = await financeiroData(normalizePeriod(req.query));
  const rows = ['data,descricao,categoria,valor,status'];
  for (const item of financeiro.lancamentos) {
    rows.push([item.data, item.descricao, item.categoria, item.valor, item.status].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
  }
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="financeiro-snoutsync.csv"');
  res.send(rows.join('\n'));
}));

app.get('/api/relatorios/financeiro.pdf', asyncRoute(async (req, res) => {
  const filters = normalizePeriod(req.query);
  const financeiro = await financeiroData(filters);
  const doc = new PDFDocument({ margin: 42 });
  res.header('Content-Type', 'application/pdf');
  res.header('Content-Disposition', 'attachment; filename="financeiro-snoutsync.pdf"');
  doc.pipe(res);
  doc.fontSize(20).text('Relatorio Financeiro - SnoutSync');
  if (filters.dataInicio || filters.dataFim) {
    doc.fontSize(10).text(`Periodo: ${filters.dataInicio || 'inicio'} a ${filters.dataFim || 'fim'}`);
  }
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
  await audit(req, { action: 'ai.asked', entityType: 'ai', metadata: { aiUsed: Boolean(modelAnswer) } });

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
