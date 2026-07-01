DO $$ BEGIN
  CREATE TYPE perfil_usuario AS ENUM ('ADMIN', 'ATENDENTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE tipo_cliente AS ENUM ('AVULSO', 'PLANO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE porte_pet AS ENUM ('P', 'M', 'G');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE status_agendamento AS ENUM ('AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS usuario (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(160) NOT NULL,
  usuario VARCHAR(80) NOT NULL UNIQUE,
  senha VARCHAR(255) NOT NULL,
  perfil perfil_usuario NOT NULL DEFAULT 'ATENDENTE',
  ativo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS cliente (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(160) NOT NULL,
  telefone VARCHAR(40),
  tipo tipo_cliente NOT NULL DEFAULT 'AVULSO'
);

CREATE TABLE IF NOT EXISTS pet (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  nome VARCHAR(160) NOT NULL,
  especie VARCHAR(80) NOT NULL DEFAULT 'Cachorro',
  raca VARCHAR(120),
  peso NUMERIC(8, 2),
  porte porte_pet NOT NULL DEFAULT 'M'
);

CREATE TABLE IF NOT EXISTS plano (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  data_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  data_fim DATE,
  preco_mensal NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS servico (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(160) NOT NULL,
  descricao TEXT,
  preco_pequeno NUMERIC(12, 2) NOT NULL DEFAULT 0,
  preco_medio NUMERIC(12, 2) NOT NULL DEFAULT 0,
  preco_grande NUMERIC(12, 2) NOT NULL DEFAULT 0,
  duracao_pequeno INTEGER NOT NULL DEFAULT 30,
  duracao_medio INTEGER NOT NULL DEFAULT 45,
  duracao_grande INTEGER NOT NULL DEFAULT 60
);

CREATE TABLE IF NOT EXISTS agendamento (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  servico_id INTEGER NOT NULL REFERENCES servico(id) ON DELETE RESTRICT,
  data DATE NOT NULL,
  hora TIME NOT NULL,
  status status_agendamento NOT NULL DEFAULT 'AGENDADO',
  observacoes TEXT
);

CREATE TABLE IF NOT EXISTS atendimento (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER NOT NULL UNIQUE REFERENCES agendamento(id) ON DELETE CASCADE,
  valor_cobrado NUMERIC(12, 2) NOT NULL DEFAULT 0,
  forma_pagamento VARCHAR(80),
  data_hora_conclusao TIMESTAMP
);

INSERT INTO usuario (nome, usuario, senha, perfil, ativo)
VALUES
  ('Leonardo', 'leonardo', 'TROCAR_SENHA', 'ADMIN', true),
  ('Atendente', 'atendente', 'TROCAR_SENHA', 'ATENDENTE', true)
ON CONFLICT (usuario) DO NOTHING;

INSERT INTO servico (nome, descricao, preco_pequeno, preco_medio, preco_grande, duracao_pequeno, duracao_medio, duracao_grande)
SELECT * FROM (VALUES
  ('Banho', 'Banho completo', 45::numeric, 60::numeric, 80::numeric, 30, 45, 60),
  ('Tosa Higienica', 'Tosa de manutencao', 35::numeric, 45::numeric, 60::numeric, 25, 35, 45),
  ('Banho e Tosa', 'Pacote completo', 80::numeric, 105::numeric, 140::numeric, 60, 80, 100)
) AS seed(nome, descricao, preco_pequeno, preco_medio, preco_grande, duracao_pequeno, duracao_medio, duracao_grande)
WHERE NOT EXISTS (SELECT 1 FROM servico s WHERE s.nome = seed.nome);
