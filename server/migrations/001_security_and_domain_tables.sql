CREATE TABLE IF NOT EXISTS refresh_token (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address VARCHAR(64),
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  replaced_by_id INTEGER REFERENCES refresh_token(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_usuario ON refresh_token (usuario_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_expires ON refresh_token (expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_token_active ON refresh_token (usuario_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS revoked_token (
  id SERIAL PRIMARY KEY,
  token_jti VARCHAR(80) NOT NULL UNIQUE,
  usuario_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reason VARCHAR(80) NOT NULL DEFAULT 'logout',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revoked_token_expires ON revoked_token (expires_at);

CREATE TABLE IF NOT EXISTS password_reset_token (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_usuario ON password_reset_token (usuario_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_token (expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80),
  entity_id VARCHAR(80),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  user_agent TEXT,
  request_id VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);

CREATE TABLE IF NOT EXISTS profissional (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(160) NOT NULL,
  telefone VARCHAR(40),
  email VARCHAR(160),
  especialidade VARCHAR(120),
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_profissional_ativo_nome ON profissional (ativo, nome);

CREATE TABLE IF NOT EXISTS despesa (
  id SERIAL PRIMARY KEY,
  descricao VARCHAR(180) NOT NULL,
  categoria VARCHAR(100) NOT NULL DEFAULT 'Operacional',
  valor NUMERIC(12, 2) NOT NULL CHECK (valor >= 0),
  data_vencimento DATE NOT NULL DEFAULT CURRENT_DATE,
  data_pagamento DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'ABERTA',
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_despesa_data_status ON despesa (data_vencimento, status);

CREATE TABLE IF NOT EXISTS produto (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(80) UNIQUE,
  nome VARCHAR(180) NOT NULL,
  descricao TEXT,
  categoria VARCHAR(100),
  preco_venda NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (preco_venda >= 0),
  custo NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (custo >= 0),
  estoque_atual INTEGER NOT NULL DEFAULT 0 CHECK (estoque_atual >= 0),
  estoque_minimo INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_produto_ativo_nome ON produto (ativo, nome);
CREATE INDEX IF NOT EXISTS idx_produto_categoria ON produto (categoria);
